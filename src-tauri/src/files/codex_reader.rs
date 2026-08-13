//! Bounded, read-only access to the local Codex on-disk format.
//!
//! Codex files are append-only JSONL in normal operation, but they are still
//! untrusted local input. This module keeps scans bounded, treats cursors as
//! opaque revision-bound values, rejects path traversal, skips symlinks, and
//! never sends tool arguments, tool output, or encrypted reasoning to the
//! renderer.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::root;
use crate::types::source::{Diagnostic, Provenance, SourceKind, TaskGraphCapability};

pub const MAX_PAGE_SIZE: usize = 100;
pub const MAX_EVENT_PAGE: usize = 500;
pub const MAX_DIAGNOSTICS: usize = 100;
pub const MAX_DISCOVERY_ENTRIES: usize = 5000;
pub const MAX_HISTORY_BASE_DEPTH: usize = 8;
pub const MAX_CURSOR_BYTES: usize = 512;
pub const MAX_QUERY_BYTES: usize = 4096;
pub const MAX_FIELD_BYTES: usize = 64 * 1024;
const MAX_SCAN_BYTES: u64 = 32 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_ROLLOUT_DEPTH: usize = 6;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorPage<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub total_matched: Option<usize>,
    pub scan_limited: bool,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorHistoryEntry {
    pub session_id: Option<String>,
    pub display: String,
    pub project: String,
    pub timestamp: Option<i64>,
    pub pasted_count: usize,
    pub source: SourceKind,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTranscriptMeta {
    pub id: String,
    pub label: String,
    pub size_bytes: u64,
    pub mtime: Option<i64>,
    pub source: SourceKind,
    pub archived: bool,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorEvent {
    pub kind: String,
    pub timestamp: Option<String>,
    pub role: Option<String>,
    pub content: Option<String>,
    pub tool_name: Option<String>,
    pub tool_id: Option<String>,
    pub tool_input_shape: Option<String>,
    pub tool_output_size: Option<usize>,
    pub tool_status: Option<String>,
    pub truncated: bool,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTaskGraphMeta {
    pub id: String,
    pub label: Option<String>,
    pub task_count: usize,
    pub latest_mtime: i64,
    pub source: SourceKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTaskGraphList {
    pub capability: TaskGraphCapability,
    pub items: Vec<InspectorTaskGraphMeta>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTaskGraphResult {
    pub id: String,
    pub nodes: Vec<Value>,
    pub capability: TaskGraphCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InspectorCursor {
    version: u8,
    source: SourceKind,
    operation: String,
    revision: String,
    offset: usize,
    id: Option<String>,
}

#[derive(Debug, Clone)]
struct IndexedLine {
    line: usize,
    text: String,
    source_file: String,
}

pub fn read_history_page(
    cursor: Option<&str>,
    limit: usize,
    query: Option<&str>,
) -> Result<InspectorPage<InspectorHistoryEntry>, String> {
    let limit = validate_limit(limit)?;
    let query = validate_query(query)?;
    let codex_root = root::codex_dir()?;
    let revision = root::source_revision(&codex_root).unwrap_or_else(|| "unknown".to_string());
    let offset = decode_cursor(cursor, "history", &revision, None)?.offset;
    let mut diagnostics = Vec::new();

    let index = read_session_index(&codex_root, &mut diagnostics);
    let lines = match read_history_chain(&codex_root, &mut diagnostics) {
        Ok(value) => value,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(InspectorPage {
                items: Vec::new(),
                next_cursor: None,
                has_more: false,
                total_matched: Some(0),
                scan_limited: false,
                diagnostics: vec![Diagnostic::new(
                    "historyMissing",
                    "Codex history.jsonl was not found",
                )],
            })
        }
        Err(error) => return Err(format!("cannot read Codex history: {error}")),
    };

    let mut entries = Vec::new();
    for indexed in &lines.items {
        if indexed.text.len() > MAX_LINE_BYTES {
            diagnostics.push(
                Diagnostic::new("lineTooLarge", "Skipped an oversized history record")
                    .at_line(indexed.line),
            );
            continue;
        }
        let value: Value = match serde_json::from_str(&indexed.text) {
            Ok(value) => value,
            Err(_) => {
                diagnostics.push(
                    Diagnostic::new("invalidJson", "Skipped an invalid history record")
                        .at_line(indexed.line),
                );
                continue;
            }
        };
        let Some(object) = value.as_object() else {
            diagnostics.push(
                Diagnostic::new("invalidRecord", "Skipped a non-object history record")
                    .at_line(indexed.line),
            );
            continue;
        };
        let has_message = ["text", "display", "message"]
            .iter()
            .any(|key| object.get(*key).and_then(Value::as_str).is_some());
        if !has_message
            && (object.contains_key("history_base")
                || object.contains_key("historyBase")
                || object.contains_key("history_mode")
                || object.contains_key("historyMode"))
        {
            continue;
        }
        let display = object
            .get("text")
            .or_else(|| object.get("display"))
            .or_else(|| object.get("message"))
            .and_then(Value::as_str)
            .map(|text| safe_text(text, MAX_FIELD_BYTES).0)
            .unwrap_or_else(|| "(empty message)".to_string());
        let project = object
            .get("cwd")
            .or_else(|| object.get("project"))
            .and_then(Value::as_str)
            .map(project_label)
            .unwrap_or_default();
        if let Some(query) = query.as_deref() {
            let haystack = format!("{display}\n{project}").to_lowercase();
            if !haystack.contains(query) {
                continue;
            }
        }
        let session_id = string_value(object, &["session_id", "sessionId", "id"])
            .map(|value| safe_text(&value, 256).0);
        let timestamp = timestamp_value(object, &["ts", "timestamp", "created_at"]);
        let pasted_count = integer_value(object, &["pasted_count", "pastedCount"])
            .and_then(|value| usize::try_from(value).ok())
            .or_else(|| {
                object
                    .get("pastedContents")
                    .and_then(Value::as_object)
                    .map(|contents| contents.len())
            })
            .unwrap_or(0);
        entries.push(InspectorHistoryEntry {
            session_id,
            display,
            project,
            timestamp,
            pasted_count,
            source: SourceKind::Codex,
            provenance: Provenance {
                source_file: indexed.source_file.clone(),
                line: Some(indexed.line),
                archived: false,
            },
        });
    }

    for entry in &mut entries {
        if let Some(session_id) = entry.session_id.as_deref() {
            if let Some(title) = index.get(session_id) {
                entry.display = if entry.display == "(empty message)" {
                    title.clone()
                } else {
                    entry.display.clone()
                };
            }
        }
    }

    let total_matched = if lines.truncated {
        None
    } else {
        Some(entries.len())
    };
    let page_start = offset.min(entries.len());
    let page_end = (page_start + limit).min(entries.len());
    let items = entries[page_start..page_end].to_vec();
    let has_more = page_end < entries.len();
    let next_cursor = has_more.then(|| {
        encode_cursor(&InspectorCursor {
            version: 1,
            source: SourceKind::Codex,
            operation: "history".to_string(),
            revision: revision.clone(),
            offset: page_end,
            id: None,
        })
    });

    diagnostics.truncate(MAX_DIAGNOSTICS);
    Ok(InspectorPage {
        items,
        next_cursor,
        has_more,
        total_matched,
        scan_limited: lines.truncated,
        diagnostics,
    })
}

pub fn list_transcripts(
    cursor: Option<&str>,
    limit: usize,
) -> Result<InspectorPage<InspectorTranscriptMeta>, String> {
    let limit = validate_limit(limit)?;
    let codex_root = root::codex_dir()?;
    let revision = root::source_revision(&codex_root).unwrap_or_else(|| "unknown".to_string());
    let offset = decode_cursor(cursor, "transcripts", &revision, None)?.offset;
    let mut files = Vec::new();
    let mut diagnostics = Vec::new();
    let mut visited_entries = 0usize;
    for (directory, archived) in [("sessions", false), ("archived_sessions", true)] {
        let path = codex_root.join(directory);
        if let Err(error) = collect_rollouts(
            &path,
            &codex_root,
            archived,
            0,
            &mut files,
            &mut visited_entries,
            &mut diagnostics,
        ) {
            if error.kind() != io::ErrorKind::NotFound {
                diagnostics.push(Diagnostic::new(
                    "directoryUnreadable",
                    format!("cannot read Codex {directory}: {error}"),
                ));
            }
        }
    }
    files.sort_by(|left, right| left.id.cmp(&right.id));
    let page_start = offset.min(files.len());
    let page_end = (page_start + limit).min(files.len());
    let has_more = page_end < files.len();
    let discovery_limited = visited_entries >= MAX_DISCOVERY_ENTRIES;
    let next_cursor = has_more.then(|| {
        encode_cursor(&InspectorCursor {
            version: 1,
            source: SourceKind::Codex,
            operation: "transcripts".to_string(),
            revision,
            offset: page_end,
            id: None,
        })
    });
    diagnostics.truncate(MAX_DIAGNOSTICS);
    Ok(InspectorPage {
        items: files[page_start..page_end].to_vec(),
        next_cursor,
        has_more,
        total_matched: (!discovery_limited).then_some(files.len()),
        scan_limited: discovery_limited,
        diagnostics,
    })
}

pub fn read_transcript(
    id: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<InspectorPage<InspectorEvent>, String> {
    let limit = validate_event_limit(limit)?;
    let codex_root = root::codex_dir()?;
    let (path, archived) = resolve_rollout(&codex_root, id)?;
    let revision = rollout_revision(&codex_root, &path, id);
    let offset = decode_cursor(cursor, "transcript", &revision, Some(id))?.offset;
    let (text, scan_limited) =
        read_capped_file(&path).map_err(|error| format!("cannot read transcript: {error}"))?;
    let mut events = Vec::new();
    let mut diagnostics = Vec::new();
    let mut event_index = 0usize;
    for (line_index, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_LINE_BYTES {
            diagnostics.push(
                Diagnostic::new("lineTooLarge", "Skipped an oversized transcript record")
                    .at_line(line_index + 1),
            );
            continue;
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => {
                diagnostics.push(
                    Diagnostic::new("invalidJson", "Skipped an invalid transcript record")
                        .at_line(line_index + 1),
                );
                continue;
            }
        };
        let Some((mut event, mut event_diagnostics)) =
            normalize_event(&value, line_index + 1, archived)
        else {
            continue;
        };
        event.provenance.source_file = id.to_string();
        diagnostics.append(&mut event_diagnostics);
        if event_index >= offset && events.len() < limit {
            events.push(event);
        }
        event_index += 1;
        if events.len() >= limit {
            break;
        }
    }
    let has_more = event_index < count_normalized_events(&text);
    let next_cursor = has_more.then(|| {
        encode_cursor(&InspectorCursor {
            version: 1,
            source: SourceKind::Codex,
            operation: "transcript".to_string(),
            revision,
            offset: offset + events.len(),
            id: Some(id.to_string()),
        })
    });
    diagnostics.truncate(MAX_DIAGNOSTICS);
    Ok(InspectorPage {
        items: events,
        next_cursor,
        has_more,
        total_matched: None,
        scan_limited,
        diagnostics,
    })
}

pub fn read_session(
    id: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<InspectorPage<InspectorEvent>, String> {
    let codex_root = root::codex_dir()?;
    let rollout_id = if id.ends_with(".jsonl") {
        id.to_string()
    } else {
        resolve_session_rollout(&codex_root, id)?
    };
    read_transcript(&rollout_id, cursor, limit)
}

pub fn list_task_graphs() -> Result<InspectorTaskGraphList, String> {
    let _ = root::codex_dir()?;
    Ok(InspectorTaskGraphList {
        capability: TaskGraphCapability::unsupported(
            "Codex does not expose the Claude Task Graph format",
        ),
        items: Vec::new(),
    })
}

pub fn read_task_graph(id: &str) -> Result<InspectorTaskGraphResult, String> {
    if id.is_empty() || id.len() > 512 || id.contains('/') || id.contains('\\') || id.contains('\0')
    {
        return Err("Codex task graph id is invalid".to_string());
    }
    let _ = root::codex_dir()?;
    Ok(InspectorTaskGraphResult {
        id: id.to_string(),
        nodes: Vec::new(),
        capability: TaskGraphCapability::unsupported(
            "Codex does not expose the Claude Task Graph format",
        ),
    })
}

fn validate_limit(limit: usize) -> Result<usize, String> {
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(format!("limit must be between 1 and {MAX_PAGE_SIZE}"));
    }
    Ok(limit)
}

fn validate_event_limit(limit: usize) -> Result<usize, String> {
    if limit == 0 || limit > MAX_EVENT_PAGE {
        return Err(format!("limit must be between 1 and {MAX_EVENT_PAGE}"));
    }
    Ok(limit)
}

fn validate_query(query: Option<&str>) -> Result<Option<String>, String> {
    let Some(query) = query else {
        return Ok(None);
    };
    if query.len() > MAX_QUERY_BYTES {
        return Err(format!("query exceeds {MAX_QUERY_BYTES} bytes"));
    }
    let query = query.trim().to_lowercase();
    Ok((!query.is_empty()).then_some(query))
}

fn encode_cursor(cursor: &InspectorCursor) -> String {
    let json = serde_json::to_vec(cursor).expect("cursor serialization is infallible");
    URL_SAFE_NO_PAD.encode(json)
}

fn decode_cursor(
    encoded: Option<&str>,
    operation: &str,
    revision: &str,
    id: Option<&str>,
) -> Result<InspectorCursor, String> {
    let Some(encoded) = encoded else {
        return Ok(InspectorCursor {
            version: 1,
            source: SourceKind::Codex,
            operation: operation.to_string(),
            revision: revision.to_string(),
            offset: 0,
            id: id.map(str::to_string),
        });
    };
    if encoded.len() > MAX_CURSOR_BYTES {
        return Err("cursor is too large".to_string());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "cursor is invalid".to_string())?;
    let cursor: InspectorCursor =
        serde_json::from_slice(&bytes).map_err(|_| "cursor is invalid".to_string())?;
    if cursor.version != 1
        || cursor.source != SourceKind::Codex
        || cursor.operation != operation
        || cursor.revision != revision
        || cursor.id.as_deref() != id
    {
        return Err("cursor is stale; reload the source".to_string());
    }
    Ok(cursor)
}

struct ReverseLines {
    items: Vec<IndexedLine>,
    truncated: bool,
}

fn read_history_chain(root: &Path, diagnostics: &mut Vec<Diagnostic>) -> io::Result<ReverseLines> {
    let mut relative = "history.jsonl".to_string();
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    let mut truncated = false;
    let mut scanned_bytes = 0_u64;

    for depth in 0..=MAX_HISTORY_BASE_DEPTH {
        if scanned_bytes >= MAX_SCAN_BYTES {
            diagnostics.push(Diagnostic::new(
                "scanLimit",
                "Stopped Codex history scanning at the configured byte budget",
            ));
            break;
        }
        if !seen.insert(relative.clone()) {
            diagnostics.push(Diagnostic::new(
                "historyBaseCycle",
                "Stopped a cyclic Codex history_base chain",
            ));
            break;
        }
        let path = match confined_path(root, &relative) {
            Ok(path) => path,
            Err(error) if depth > 0 && error.kind() == io::ErrorKind::NotFound => {
                diagnostics.push(Diagnostic::new(
                    "historyBaseMissing",
                    "Stopped a Codex history_base chain at a missing file",
                ));
                break;
            }
            Err(_error) if depth > 0 => {
                diagnostics.push(Diagnostic::new(
                    "historyBaseOutsideRoot",
                    "Rejected a Codex history_base reference outside the source root",
                ));
                break;
            }
            Err(error) => return Err(error),
        };
        let (mut text, file_truncated) = match read_capped_file_from_path(&path, true) {
            Ok(value) => value,
            Err(error) if depth > 0 && error.kind() == io::ErrorKind::NotFound => {
                diagnostics.push(Diagnostic::new(
                    "historyBaseMissing",
                    "Stopped a Codex history_base chain at a missing file",
                ));
                break;
            }
            Err(error) => return Err(error),
        };
        truncated |= file_truncated;
        let remaining = MAX_SCAN_BYTES.saturating_sub(scanned_bytes) as usize;
        if text.len() > remaining {
            let mut end = remaining;
            while end > 0 && !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
            truncated = true;
        }
        scanned_bytes = scanned_bytes.saturating_add(text.len() as u64);
        let mut file_items: Vec<_> = text
            .lines()
            .enumerate()
            .map(|(index, text)| IndexedLine {
                line: index + 1,
                text: text.to_string(),
                source_file: relative.clone(),
            })
            .collect();
        file_items.reverse();
        items.extend(file_items);

        let Some(base) = history_base_reference(&text) else {
            break;
        };
        if depth == MAX_HISTORY_BASE_DEPTH {
            diagnostics.push(Diagnostic::new(
                "historyBaseDepth",
                "Stopped a Codex history_base chain at the configured depth",
            ));
            break;
        }
        if base.is_empty() || base.len() > 512 || base.contains('\0') {
            diagnostics.push(Diagnostic::new(
                "historyBaseInvalid",
                "Stopped a Codex history_base chain with an invalid reference",
            ));
            break;
        }
        let base_path = Path::new(&base);
        if base_path.is_absolute()
            || base_path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            diagnostics.push(Diagnostic::new(
                "historyBaseOutsideRoot",
                "Rejected a Codex history_base reference outside the source root",
            ));
            break;
        }
        relative = base;
    }

    Ok(ReverseLines { items, truncated })
}

fn history_base_reference(text: &str) -> Option<String> {
    text.lines().rev().find_map(|line| {
        let value = serde_json::from_str::<Value>(line).ok()?;
        value
            .get("history_base")
            .or_else(|| value.get("historyBase"))
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

fn read_session_index(root: &Path, diagnostics: &mut Vec<Diagnostic>) -> HashMap<String, String> {
    let Ok((text, _)) = read_capped_file_from_relative(root, "session_index.jsonl", true) else {
        return HashMap::new();
    };
    let mut index = HashMap::new();
    for (line_index, line) in text.lines().enumerate() {
        if line.trim().is_empty() || line.len() > MAX_LINE_BYTES {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            diagnostics.push(
                Diagnostic::new("invalidJson", "Skipped an invalid session index record")
                    .at_line(line_index + 1),
            );
            continue;
        };
        let Some(object) = value.as_object() else {
            continue;
        };
        let Some(id) = string_value(object, &["id", "session_id", "sessionId"]) else {
            continue;
        };
        if let Some(title) = string_value(object, &["thread_name", "threadName", "title"]) {
            index.insert(id, safe_text(&title, MAX_FIELD_BYTES).0);
        }
    }
    index
}

fn collect_rollouts(
    directory: &Path,
    root: &Path,
    archived: bool,
    depth: usize,
    files: &mut Vec<InspectorTranscriptMeta>,
    visited_entries: &mut usize,
    diagnostics: &mut Vec<Diagnostic>,
) -> io::Result<()> {
    if *visited_entries >= MAX_DISCOVERY_ENTRIES || files.len() >= MAX_DISCOVERY_ENTRIES {
        diagnostics.push(Diagnostic::new(
            "discoveryLimit",
            "Stopped Codex transcript discovery at the configured entry limit",
        ));
        return Ok(());
    }
    if depth > MAX_ROLLOUT_DEPTH {
        diagnostics.push(Diagnostic::new(
            "directoryDepthExceeded",
            "Skipped a Codex transcript directory that was too deep",
        ));
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "directoryEntryUnreadable",
                    format!("skipped an unreadable Codex directory entry: {error}"),
                ));
                continue;
            }
        };
        *visited_entries = (*visited_entries).saturating_add(1);
        if *visited_entries > MAX_DISCOVERY_ENTRIES {
            diagnostics.push(Diagnostic::new(
                "discoveryLimit",
                "Stopped Codex transcript discovery at the configured entry limit",
            ));
            return Ok(());
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "fileTypeUnreadable",
                    format!("skipped a Codex entry with unreadable metadata: {error}"),
                ));
                continue;
            }
        };
        if file_type.is_symlink() {
            diagnostics.push(Diagnostic::new(
                "symlinkSkipped",
                "Skipped a symlink in the Codex transcript tree",
            ));
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_rollouts(
                &path,
                root,
                archived,
                depth + 1,
                files,
                visited_entries,
                diagnostics,
            )?;
            if files.len() >= MAX_DISCOVERY_ENTRIES {
                return Ok(());
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with("rollout-")
            || path.extension().and_then(|ext| ext.to_str()) != Some("jsonl")
        {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "transcript path escaped root")
            })?
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "metadataUnreadable",
                    format!("skipped Codex transcript metadata: {error}"),
                ));
                continue;
            }
        };
        files.push(InspectorTranscriptMeta {
            id: relative.clone(),
            label: name.to_string(),
            size_bytes: metadata.len(),
            mtime: modified_ms(&metadata),
            source: SourceKind::Codex,
            archived,
            provenance: Provenance {
                source_file: relative,
                line: None,
                archived,
            },
        });
    }
    Ok(())
}

fn resolve_rollout(root: &Path, id: &str) -> Result<(PathBuf, bool), String> {
    if id.is_empty() || id.len() > 512 || id.contains('\\') || id.contains('\0') {
        return Err("transcript id is invalid".to_string());
    }
    let relative = Path::new(id);
    let mut components = relative.components();
    if components.any(|component| !matches!(component, Component::Normal(_))) {
        return Err("transcript id must be a relative file path".to_string());
    }
    if relative.extension().and_then(|ext| ext.to_str()) != Some("jsonl")
        || relative
            .file_name()
            .and_then(|name| name.to_str())
            .is_none_or(|name| !name.starts_with("rollout-"))
    {
        return Err("transcript id is not a Codex rollout".to_string());
    }
    let root_directory = relative
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(name) => name.to_str(),
            _ => None,
        });
    if !matches!(root_directory, Some("sessions" | "archived_sessions")) {
        return Err("transcript id is outside the Codex session roots".to_string());
    }
    let archived = relative
        .components()
        .next()
        .is_some_and(|component| component.as_os_str() == "archived_sessions");
    let path =
        confined_path(root, id).map_err(|error| format!("cannot open transcript: {error}"))?;
    Ok((path, archived))
}

fn resolve_session_rollout(root: &Path, session_id: &str) -> Result<String, String> {
    if session_id.is_empty()
        || session_id.len() > 256
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains('\0')
    {
        return Err("session id is invalid".to_string());
    }
    let transcripts = list_transcripts(None, MAX_PAGE_SIZE)?;
    for transcript in transcripts.items {
        let (path, _) = resolve_rollout(root, &transcript.id)?;
        let Ok((text, _)) = read_capped_file(&path) else {
            continue;
        };
        for line in text.lines().filter(|line| line.len() <= MAX_LINE_BYTES) {
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if value_contains_session_id(&value, session_id) {
                return Ok(transcript.id);
            }
        }
    }
    Err("Codex session was not found in the discovered rollout files".to_string())
}

fn value_contains_session_id(value: &Value, session_id: &str) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    ["id", "session_id", "sessionId"]
        .iter()
        .any(|key| object.get(*key).and_then(Value::as_str) == Some(session_id))
        || object
            .get("payload")
            .is_some_and(|payload| value_contains_session_id(payload, session_id))
}

fn confined_path(root: &Path, relative: &str) -> io::Result<PathBuf> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "path is outside the Codex root",
        ));
    }
    let canonical_root = fs::canonicalize(root)?;
    let candidate = root.join(relative_path);
    let mut component_path = root.to_path_buf();
    for component in relative_path.components() {
        let Component::Normal(component) = component else {
            continue;
        };
        component_path.push(component);
        if fs::symlink_metadata(&component_path)?
            .file_type()
            .is_symlink()
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "symlink paths are not allowed in the Codex root",
            ));
        }
    }
    let canonical_candidate = fs::canonicalize(&candidate)?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "path is outside the Codex root",
        ));
    }
    Ok(canonical_candidate)
}

fn read_capped_file(path: &Path) -> io::Result<(String, bool)> {
    read_capped_file_from_path(path, false)
}

fn read_capped_file_from_relative(
    root: &Path,
    relative: &str,
    from_end: bool,
) -> io::Result<(String, bool)> {
    let path = confined_path(root, relative)?;
    read_capped_file_from_path(&path, from_end)
}

fn read_capped_file_from_path(path: &Path, from_end: bool) -> io::Result<(String, bool)> {
    let mut file = open_read_no_follow(path)?;
    let length = file.metadata()?.len();
    let truncated = length > MAX_SCAN_BYTES;
    if from_end {
        let start = length.saturating_sub(MAX_SCAN_BYTES);
        file.seek(SeekFrom::Start(start))?;
        let mut bytes = Vec::with_capacity(MAX_SCAN_BYTES as usize);
        file.take(MAX_SCAN_BYTES).read_to_end(&mut bytes)?;
        if start > 0 {
            if let Some(first_newline) = bytes.iter().position(|byte| *byte == b'\n') {
                bytes.drain(..=first_newline);
            } else {
                bytes.clear();
            }
        }
        return Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated));
    }
    let mut bytes = Vec::with_capacity(length.min(MAX_SCAN_BYTES) as usize);
    file.take(MAX_SCAN_BYTES).read_to_end(&mut bytes)?;
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

fn open_read_no_follow(path: &Path) -> io::Result<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Codex transcript reads require a no-follow file-open primitive",
        ))
    }
}

fn normalize_event(
    value: &Value,
    line: usize,
    archived: bool,
) -> Option<(InspectorEvent, Vec<Diagnostic>)> {
    let payload = value.get("payload").unwrap_or(value);
    let outer_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let payload_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(outer_type);
    let timestamp = string_field(value, &["timestamp", "ts", "created_at"])
        .or_else(|| string_field(payload, &["timestamp", "ts", "created_at"]))
        .map(|value| safe_text(&value, MAX_FIELD_BYTES).0);
    let provenance = Provenance {
        source_file: String::new(),
        line: Some(line),
        archived,
    };
    let mut diagnostics = Vec::new();
    let mut event = InspectorEvent {
        kind: payload_type.to_string(),
        timestamp,
        role: None,
        content: None,
        tool_name: None,
        tool_id: None,
        tool_input_shape: None,
        tool_output_size: None,
        tool_status: None,
        truncated: false,
        provenance,
    };

    match payload_type {
        "reasoning" | "encrypted_content" | "encrypted_reasoning" | "reasoning_content" => {
            return None;
        }
        "message" | "user_message" | "agent_message" => {
            event.role =
                string_field(payload, &["role"]).map(|role| safe_text(&role, MAX_FIELD_BYTES).0);
            let source = payload
                .get("content")
                .or_else(|| payload.get("message"))
                .or_else(|| payload.get("text"));
            if let Some(source) = source {
                let (content, truncated) = extract_message_text(source);
                event.content = content;
                event.truncated = truncated;
            }
        }
        "function_call" | "custom_tool_call" | "tool_call" => {
            event.tool_name = string_field(payload, &["name", "tool_name", "toolName"])
                .map(|name| safe_text(&name, 256).0);
            event.tool_id =
                string_field(payload, &["id", "call_id", "callId"]).map(|id| safe_text(&id, 256).0);
            event.tool_input_shape = payload
                .get("arguments")
                .or_else(|| payload.get("input"))
                .or_else(|| payload.get("parameters"))
                .map(json_shape);
            event.tool_status = safe_status(payload);
        }
        "function_call_output" | "custom_tool_call_output" | "tool_output" => {
            event.tool_name = string_field(payload, &["name", "tool_name", "toolName"])
                .map(|name| safe_text(&name, 256).0);
            event.tool_id =
                string_field(payload, &["id", "call_id", "callId"]).map(|id| safe_text(&id, 256).0);
            event.tool_output_size = payload
                .get("output")
                .or_else(|| payload.get("result"))
                .map(json_size);
            event.tool_status = safe_status(payload);
        }
        "task_started" | "task_complete" | "token_count" | "session_meta" => {}
        _ => {
            event.kind = "unknown".to_string();
            diagnostics.push(
                Diagnostic::new(
                    "unknownEvent",
                    "Preserved an unknown Codex event as metadata",
                )
                .at_line(line),
            );
        }
    }
    Some((event, diagnostics))
}

fn count_normalized_events(text: &str) -> usize {
    text.lines()
        .filter(|line| !line.trim().is_empty() && line.len() <= MAX_LINE_BYTES)
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|value| normalize_event(value, 0, false).is_some())
        .count()
}

fn extract_message_text(value: &Value) -> (Option<String>, bool) {
    match value {
        Value::String(text) => {
            let (text, truncated) = safe_text(text, MAX_FIELD_BYTES);
            (Some(text), truncated)
        }
        Value::Array(items) => {
            let mut parts = Vec::new();
            for item in items {
                if let Some(text) = item
                    .get("text")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("content").and_then(Value::as_str))
                {
                    parts.push(text.to_string());
                }
            }
            if parts.is_empty() {
                return (None, false);
            }
            let (text, truncated) = safe_text(&parts.join("\n"), MAX_FIELD_BYTES);
            (Some(text), truncated)
        }
        Value::Object(object) => object
            .get("text")
            .or_else(|| object.get("content"))
            .map(extract_message_text)
            .unwrap_or((None, false)),
        _ => (None, false),
    }
}

fn json_shape(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(_) => "boolean".to_string(),
        Value::Number(_) => "number".to_string(),
        Value::String(_) => "string".to_string(),
        Value::Array(_) => "array".to_string(),
        Value::Object(_) => "object".to_string(),
    }
}

fn json_size(value: &Value) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(0)
}

fn safe_status(value: &Value) -> Option<String> {
    let status = string_field(value, &["status", "phase"])?;
    match status.as_str() {
        "queued" | "running" | "in_progress" | "completed" | "failed" | "cancelled" => Some(status),
        _ => None,
    }
}

fn string_value(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str).map(str::to_string))
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    value
        .as_object()
        .and_then(|object| string_value(object, keys))
}

fn integer_value(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        let value = object.get(*key)?;
        value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
            .or_else(|| value.as_f64().map(|value| value as i64))
    })
}

fn timestamp_value(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<i64> {
    integer_value(object, keys).or_else(|| {
        keys.iter().find_map(|key| {
            let value = object.get(*key)?.as_str()?;
            value.parse::<i64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc3339(value)
                    .ok()
                    .map(|date| date.timestamp_millis())
            })
        })
    })
}

fn project_label(value: &str) -> String {
    let path = Path::new(value);
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(|name| safe_text(name, 256).0)
        .unwrap_or_else(|| safe_text(value, 256).0)
}

fn safe_text(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    (format!("{}…", &value[..end]), true)
}

fn modified_ms(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn rollout_revision(codex_root: &Path, path: &Path, id: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    root::source_revision(codex_root).hash(&mut hasher);
    id.hash(&mut hasher);
    if let Ok(metadata) = fs::metadata(path) {
        metadata.len().hash(&mut hasher);
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|modified| modified.as_nanos().hash(&mut hasher));
    }
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
#[path = "codex_reader_tests.rs"]
mod tests;
