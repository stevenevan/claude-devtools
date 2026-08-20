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
use crate::files::codex_redaction;
use crate::types::source::{
    Diagnostic, InspectorEvent, InspectorHistoryEntry, InspectorPage, InspectorSessionSummary,
    InspectorTaskGraphList, InspectorTaskGraphMeta, InspectorTaskGraphResult, InspectorTaskNode,
    InspectorTranscriptMeta, Provenance, SourceKind, TaskGraphCapability,
};

pub const MAX_PAGE_SIZE: usize = 100;
pub const MAX_EVENT_PAGE: usize = 500;
pub const MAX_DIAGNOSTICS: usize = 100;
pub const MAX_DISCOVERY_ENTRIES: usize = 5000;
pub const MAX_HISTORY_BASE_DEPTH: usize = 8;
pub const MAX_CURSOR_BYTES: usize = 512;
pub const MAX_QUERY_BYTES: usize = 4096;
pub const MAX_FIELD_BYTES: usize = 64 * 1024;
pub const MAX_SESSION_RESOLUTION_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_SESSION_RESOLUTION_FILES: usize = 256;
const MAX_SCAN_BYTES: u64 = 32 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_ROLLOUT_DEPTH: usize = 6;
const MAX_TASK_GRAPHS: usize = 128;
const MAX_TASK_GRAPH_NODES: usize = 500;
const MAX_TASK_GRAPH_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InspectorCursor {
    version: u8,
    source: SourceKind,
    operation: String,
    revision: String,
    offset: usize,
    id: Option<String>,
    #[serde(default)]
    byte_offset: Option<usize>,
    #[serde(default)]
    event_offset: Option<usize>,
    #[serde(default)]
    total_events: Option<usize>,
    #[serde(default)]
    turn_count: Option<usize>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    session_line: Option<usize>,
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
                revision: Some(revision),
                session: None,
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
            .map(|text| safe_display_text(text, MAX_FIELD_BYTES).0)
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
                    codex_redaction::redact_known_secrets(title)
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
            byte_offset: None,
            event_offset: None,
            total_events: None,
            turn_count: None,
            session_id: None,
            project: None,
            session_line: None,
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
        revision: Some(revision),
        session: None,
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
            revision: revision.clone(),
            offset: page_end,
            id: None,
            byte_offset: None,
            event_offset: None,
            total_events: None,
            turn_count: None,
            session_id: None,
            project: None,
            session_line: None,
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
        revision: Some(revision),
        session: None,
    })
}

pub fn read_transcript(
    id: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<InspectorPage<InspectorEvent>, String> {
    read_transcript_page(id, cursor, limit, false)
}

pub fn read_session(
    id: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<InspectorPage<InspectorEvent>, String> {
    let codex_root = root::codex_dir()?;
    let revision = root::source_revision(&codex_root).unwrap_or_else(|| "unknown".to_string());
    let rollout_id = if id.ends_with(".jsonl") {
        id.to_string()
    } else {
        match resolve_session_rollout(&codex_root, id)? {
            SessionResolution::Found(rollout_id) => rollout_id,
            SessionResolution::Limited => {
                return Ok(InspectorPage {
                    items: Vec::new(),
                    next_cursor: None,
                    has_more: false,
                    total_matched: None,
                    scan_limited: true,
                    diagnostics: vec![Diagnostic::new(
                        "sessionResolutionLimited",
                        "Stopped Codex session discovery at the configured scan budget",
                    )],
                    revision: Some(revision),
                    session: None,
                });
            }
            SessionResolution::NotFound => {
                return Err("Codex session was not found in the bounded rollout scan".to_string());
            }
        }
    };
    read_transcript_page(&rollout_id, cursor, limit, true)
}

fn read_transcript_page(
    id: &str,
    cursor: Option<&str>,
    limit: usize,
    include_session: bool,
) -> Result<InspectorPage<InspectorEvent>, String> {
    let limit = validate_event_limit(limit)?;
    let codex_root = root::codex_dir()?;
    let (path, archived) = resolve_rollout(&codex_root, id)?;
    let revision = rollout_revision(&codex_root, &path, id);
    let cursor = decode_cursor(cursor, "transcript", &revision, Some(id))?;
    let (text, scan_limited) =
        read_capped_file(&path).map_err(|error| format!("cannot read transcript: {error}"))?;
    let start_offset = cursor.byte_offset.unwrap_or(0);
    if start_offset > text.len() || !text.is_char_boundary(start_offset) {
        return Err("cursor is invalid; reload the transcript".to_string());
    }
    let page_start = cursor.event_offset.unwrap_or(cursor.offset);
    let mut events = Vec::new();
    let mut diagnostics = Vec::new();
    let mut event_index = page_start;
    let mut turn_count = cursor.turn_count.unwrap_or(0);
    let mut session_id = cursor.session_id.clone();
    let mut project = cursor.project.clone();
    let mut session_line = cursor.session_line;
    let mut next_byte_offset = None;
    let mut page_complete = false;
    let mut line_start = start_offset;
    let mut line_index = text[..start_offset]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1;

    for segment in text[start_offset..].split_inclusive('\n') {
        let line_end = line_start + segment.len();
        let line_without_newline = segment.strip_suffix('\n').unwrap_or(segment);
        let line = line_without_newline
            .strip_suffix('\r')
            .unwrap_or(line_without_newline);
        if line.trim().is_empty() {
            line_start = line_end;
            line_index += 1;
            continue;
        }
        if line.len() > MAX_LINE_BYTES {
            diagnostics.push(
                Diagnostic::new("lineTooLarge", "Skipped an oversized transcript record")
                    .at_line(line_index),
            );
            line_start = line_end;
            line_index += 1;
            continue;
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => {
                diagnostics.push(
                    Diagnostic::new("invalidJson", "Skipped an invalid transcript record")
                        .at_line(line_index),
                );
                line_start = line_end;
                line_index += 1;
                continue;
            }
        };
        if include_session {
            if let Some(metadata) = session_metadata(&value) {
                session_id = session_id.or(metadata.session_id);
                project = project.or(metadata.project.map(|value| project_label(&value)));
                session_line = session_line.or(Some(line_index));
            }
        }
        let Some((mut event, mut event_diagnostics)) =
            normalize_event(&value, line_index, archived)
        else {
            line_start = line_end;
            line_index += 1;
            continue;
        };
        event.provenance.source_file = id.to_string();
        diagnostics.append(&mut event_diagnostics);
        if event.role.as_deref() == Some("user") || event.kind == "user_message" {
            turn_count = turn_count.saturating_add(1);
        }
        let current_index = event_index;
        event_index = event_index.saturating_add(1);
        if !page_complete && current_index >= page_start {
            events.push(event);
            if events.len() >= limit {
                page_complete = true;
                next_byte_offset = Some(line_end);
            }
        }
        line_start = line_end;
        line_index += 1;
    }
    let total_events = (!scan_limited).then_some(event_index);
    let has_more = page_complete && event_index > page_start.saturating_add(events.len());
    let next_cursor = has_more.then(|| {
        encode_cursor(&InspectorCursor {
            version: 1,
            source: SourceKind::Codex,
            operation: "transcript".to_string(),
            revision: revision.clone(),
            offset: page_start + events.len(),
            id: Some(id.to_string()),
            byte_offset: next_byte_offset,
            event_offset: Some(page_start + events.len()),
            total_events,
            turn_count: Some(turn_count),
            session_id: session_id.clone(),
            project: project.clone(),
            session_line,
        })
    });
    diagnostics.truncate(MAX_DIAGNOSTICS);
    let session = include_session.then(|| InspectorSessionSummary {
        session_id: session_id.unwrap_or_else(|| id.to_string()),
        project: project.unwrap_or_default(),
        transcript_id: id.to_string(),
        turn_count,
        event_count: total_events,
        counts_complete: !scan_limited,
        source: SourceKind::Codex,
        provenance: Provenance {
            source_file: id.to_string(),
            line: session_line,
            archived,
        },
    });
    Ok(InspectorPage {
        items: events,
        next_cursor,
        has_more,
        total_matched: total_events,
        scan_limited,
        diagnostics,
        revision: Some(revision),
        session,
    })
}

pub fn list_task_graphs() -> Result<InspectorTaskGraphList, String> {
    let codex_root = root::codex_dir()?;
    let tasks = codex_root.join("tasks");
    let metadata = match fs::symlink_metadata(&tasks) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(InspectorTaskGraphList {
                capability: TaskGraphCapability::missing(
                    "Codex task graphs directory was not found",
                ),
                items: Vec::new(),
            });
        }
        Err(error) => return Err(format!("cannot inspect Codex task graphs: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Ok(InspectorTaskGraphList {
            capability: TaskGraphCapability::unsupported(
                "Codex task graphs directory is not a compatible directory",
            ),
            items: Vec::new(),
        });
    }

    let mut graph_ids = Vec::new();
    let mut diagnostics = Vec::new();
    for entry in
        fs::read_dir(&tasks).map_err(|error| format!("cannot read Codex task graphs: {error}"))?
    {
        if graph_ids.len() >= MAX_TASK_GRAPHS {
            diagnostics.push(Diagnostic::new(
                "taskGraphLimit",
                "Stopped Codex task graph discovery at the configured graph limit",
            ));
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "taskGraphEntryUnreadable",
                    format!("skipped an unreadable Codex task graph entry: {error}"),
                ));
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "taskGraphMetadataUnreadable",
                    format!("skipped a Codex task graph with unreadable metadata: {error}"),
                ));
                continue;
            }
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if validate_task_graph_id(&id).is_err() {
            diagnostics.push(Diagnostic::new(
                "invalidTaskGraphId",
                "Skipped a Codex task graph with an unsafe identifier",
            ));
            continue;
        }
        graph_ids.push(id);
    }
    graph_ids.sort();

    let mut items = Vec::new();
    let mut has_files = false;
    let mut has_nodes = false;
    let mut scan_limited = false;
    for id in graph_ids {
        let graph = read_task_graph_from_root(&codex_root, &id)?;
        has_files |= graph.has_files;
        has_nodes |= !graph.nodes.is_empty();
        scan_limited |= graph.scan_limited;
        diagnostics.extend(graph.diagnostics);
        let latest_mtime = graph.latest_mtime;
        let label = graph
            .nodes
            .first()
            .map(|node| node.subject.clone())
            .filter(|subject| !subject.is_empty())
            .or_else(|| {
                graph
                    .nodes
                    .first()
                    .map(|node| node.description.clone())
                    .filter(|description| !description.is_empty())
            });
        items.push(InspectorTaskGraphMeta {
            id: id.clone(),
            label,
            task_count: graph.nodes.len(),
            latest_mtime,
            source: SourceKind::Codex,
            provenance: Some(Provenance {
                source_file: format!("tasks/{id}"),
                line: None,
                archived: false,
            }),
        });
    }
    diagnostics.truncate(MAX_DIAGNOSTICS);
    let capability = if has_nodes {
        let mut capability = TaskGraphCapability::available();
        if scan_limited {
            capability.reason = "Codex task graph scan is partial".to_string();
        }
        capability.diagnostics = diagnostics;
        capability
    } else if has_files {
        let mut capability = TaskGraphCapability::unsupported(
            "Codex task graph files did not match the supported node format",
        );
        capability.diagnostics = diagnostics;
        capability
    } else {
        let mut capability = TaskGraphCapability::missing("No Codex task graphs were found");
        capability.diagnostics = diagnostics;
        capability
    };
    Ok(InspectorTaskGraphList { capability, items })
}

pub fn read_task_graph(id: &str) -> Result<InspectorTaskGraphResult, String> {
    validate_task_graph_id(id)?;
    let codex_root = root::codex_dir()?;
    let graph = read_task_graph_from_root(&codex_root, id)?;
    let mut capability = if !graph.has_files {
        TaskGraphCapability::missing("Codex task graph was not found")
    } else if graph.nodes.is_empty() {
        TaskGraphCapability::unsupported(
            "Codex task graph files did not match the supported node format",
        )
    } else {
        TaskGraphCapability::available()
    };
    if graph.scan_limited {
        capability.reason = "Codex task graph is partial".to_string();
    }
    capability.diagnostics = graph.diagnostics;
    Ok(InspectorTaskGraphResult {
        id: id.to_string(),
        nodes: graph.nodes,
        capability,
        provenance: Some(Provenance {
            source_file: format!("tasks/{id}"),
            line: None,
            archived: false,
        }),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawTaskNode {
    id: String,
    subject: String,
    description: String,
    active_form: String,
    status: String,
    blocks: Vec<String>,
    blocked_by: Vec<String>,
}

impl Default for RawTaskNode {
    fn default() -> Self {
        Self {
            id: String::new(),
            subject: String::new(),
            description: String::new(),
            active_form: String::new(),
            status: String::new(),
            blocks: Vec::new(),
            blocked_by: Vec::new(),
        }
    }
}

struct TaskGraphRead {
    nodes: Vec<InspectorTaskNode>,
    diagnostics: Vec<Diagnostic>,
    has_files: bool,
    scan_limited: bool,
    latest_mtime: i64,
}

fn read_task_graph_from_root(root: &Path, id: &str) -> Result<TaskGraphRead, String> {
    let relative_dir = format!("tasks/{id}");
    let directory = match confined_path(root, &relative_dir) {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(TaskGraphRead {
                nodes: Vec::new(),
                diagnostics: Vec::new(),
                has_files: false,
                scan_limited: false,
                latest_mtime: 0,
            });
        }
        Err(error) => return Err(format!("cannot open Codex task graph: {error}")),
    };
    let mut leaves = Vec::new();
    let mut diagnostics = Vec::new();
    let mut has_files = false;
    let mut scan_limited = false;
    let mut latest_mtime = 0_i64;
    let mut visited = 0usize;
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("cannot read Codex task graph: {error}"))?
    {
        if visited >= MAX_TASK_GRAPH_NODES {
            scan_limited = true;
            diagnostics.push(Diagnostic::new(
                "taskGraphLimit",
                "Stopped Codex task graph scanning at the configured node limit",
            ));
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "taskGraphEntryUnreadable",
                    format!("skipped an unreadable Codex task graph entry: {error}"),
                ));
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "taskGraphMetadataUnreadable",
                    format!("skipped a Codex task graph entry with unreadable metadata: {error}"),
                ));
                continue;
            }
        };
        if file_type.is_symlink() || !file_type.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(number) = name
            .strip_suffix(".json")
            .and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        has_files = true;
        let metadata = match fs::metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "taskGraphMetadataUnreadable",
                    format!("skipped Codex task node metadata: {error}"),
                ));
                continue;
            }
        };
        latest_mtime = latest_mtime.max(modified_ms(&metadata).unwrap_or(0));
        leaves.push((number, name, metadata.len()));
        visited += 1;
    }
    leaves.sort_by_key(|(number, _, _)| *number);
    let mut nodes = Vec::new();
    let mut scanned_bytes = 0_u64;
    for (_, name, size) in leaves {
        if scanned_bytes.saturating_add(size) > MAX_TASK_GRAPH_BYTES {
            scan_limited = true;
            diagnostics.push(Diagnostic::new(
                "taskGraphByteLimit",
                "Stopped Codex task graph scanning at the configured byte budget",
            ));
            break;
        }
        scanned_bytes = scanned_bytes.saturating_add(size);
        let relative = format!("{relative_dir}/{name}");
        let path = match confined_path(root, &relative) {
            Ok(path) => path,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "taskGraphPathRejected",
                    format!("skipped a Codex task node outside the source root: {error}"),
                ));
                continue;
            }
        };
        let (text, truncated) = match read_capped_file(&path) {
            Ok(value) => value,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "taskGraphReadFailed",
                    format!("skipped a Codex task node because it could not be read: {error}"),
                ));
                continue;
            }
        };
        if truncated {
            scan_limited = true;
            diagnostics.push(Diagnostic::new(
                "taskGraphNodeTruncated",
                "Skipped a Codex task node larger than the configured file budget",
            ));
            continue;
        }
        let value: Value = match serde_json::from_str(&text) {
            Ok(value) => value,
            Err(_) => {
                diagnostics.push(Diagnostic::new(
                    "invalidTaskNode",
                    "Skipped a malformed Codex task node",
                ));
                continue;
            }
        };
        let Some(mut node) = parse_task_node(&value, &relative, &mut diagnostics) else {
            continue;
        };
        node.provenance = Some(Provenance {
            source_file: relative,
            line: None,
            archived: false,
        });
        nodes.push(node);
    }
    let ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    for node in &nodes {
        for dependency in node.blocks.iter().chain(node.blocked_by.iter()) {
            if !ids.contains(dependency.as_str()) {
                diagnostics.push(Diagnostic::new(
                    "missingTaskReference",
                    "Codex task graph edge points to a missing node",
                ));
            }
        }
    }
    diagnostics.truncate(MAX_DIAGNOSTICS);
    Ok(TaskGraphRead {
        nodes,
        diagnostics,
        has_files,
        scan_limited,
        latest_mtime,
    })
}

fn parse_task_node(
    value: &Value,
    source_file: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<InspectorTaskNode> {
    let raw: RawTaskNode = match serde_json::from_value(value.clone()) {
        Ok(raw) => raw,
        Err(_) => {
            diagnostics.push(Diagnostic::new(
                "invalidTaskNode",
                "Codex task node fields have invalid types",
            ));
            return None;
        }
    };
    if validate_task_node_id(&raw.id).is_err() {
        diagnostics.push(Diagnostic::new(
            "invalidTaskNodeId",
            "Skipped a Codex task node with an unsafe identifier",
        ));
        return None;
    }
    let capped = |value: String, field: &str, diagnostics: &mut Vec<Diagnostic>| {
        let (value, truncated) = safe_display_text(&value, MAX_FIELD_BYTES);
        if truncated {
            diagnostics.push(
                Diagnostic::new("taskFieldTruncated", "Truncated a Codex task field")
                    .with_field(field),
            );
        }
        value
    };
    let mut blocks = Vec::new();
    for dependency in raw.blocks {
        if validate_task_node_id(&dependency).is_ok() {
            blocks.push(dependency);
        } else {
            diagnostics.push(Diagnostic::new(
                "invalidTaskReference",
                "Skipped an unsafe Codex task graph edge",
            ));
        }
    }
    let mut blocked_by = Vec::new();
    for dependency in raw.blocked_by {
        if validate_task_node_id(&dependency).is_ok() {
            blocked_by.push(dependency);
        } else {
            diagnostics.push(Diagnostic::new(
                "invalidTaskReference",
                "Skipped an unsafe Codex task graph edge",
            ));
        }
    }
    Some(InspectorTaskNode {
        id: raw.id,
        subject: capped(raw.subject, "subject", diagnostics),
        description: capped(raw.description, "description", diagnostics),
        active_form: capped(raw.active_form, "activeForm", diagnostics),
        status: capped(raw.status, "status", diagnostics),
        blocks,
        blocked_by,
        provenance: Some(Provenance {
            source_file: source_file.to_string(),
            line: None,
            archived: false,
        }),
    })
}

fn validate_task_graph_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 512 || id.contains('/') || id.contains('\\') || id.contains('\0')
    {
        return Err("Codex task graph id is invalid".to_string());
    }
    Ok(())
}

fn validate_task_node_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 256 || id.contains('/') || id.contains('\\') || id.contains('\0')
    {
        return Err("Codex task graph id is invalid".to_string());
    }
    Ok(())
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
            byte_offset: None,
            event_offset: None,
            total_events: None,
            turn_count: None,
            session_id: None,
            project: None,
            session_line: None,
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
    let directory_metadata = fs::symlink_metadata(directory)?;
    if directory_metadata.file_type().is_symlink() {
        diagnostics.push(Diagnostic::new(
            "symlinkSkipped",
            "Skipped a symlink in the Codex transcript tree",
        ));
        return Ok(());
    }
    if !directory_metadata.is_dir() {
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

enum SessionResolution {
    Found(String),
    NotFound,
    Limited,
}

fn resolve_session_rollout(root: &Path, session_id: &str) -> Result<SessionResolution, String> {
    if session_id.is_empty()
        || session_id.len() > 256
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains('\0')
    {
        return Err("session id is invalid".to_string());
    }
    let mut transcripts = Vec::new();
    let mut diagnostics = Vec::new();
    let mut visited_entries = 0usize;
    for (directory, archived) in [("sessions", false), ("archived_sessions", true)] {
        let path = root.join(directory);
        if let Err(error) = collect_rollouts(
            &path,
            root,
            archived,
            0,
            &mut transcripts,
            &mut visited_entries,
            &mut diagnostics,
        ) {
            if error.kind() != io::ErrorKind::NotFound {
                return Err(format!("cannot discover Codex sessions: {error}"));
            }
        }
    }
    transcripts.sort_by(|left, right| left.id.cmp(&right.id));
    let mut discovery_limited = visited_entries >= MAX_DISCOVERY_ENTRIES;
    if transcripts.len() > MAX_SESSION_RESOLUTION_FILES {
        discovery_limited = true;
    }
    let mut scanned_bytes = 0_u64;
    for transcript in transcripts.iter().take(MAX_SESSION_RESOLUTION_FILES) {
        let (path, _) = resolve_rollout(root, &transcript.id)?;
        let size = fs::metadata(&path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let candidate_size = size.min(MAX_SCAN_BYTES);
        if scanned_bytes.saturating_add(candidate_size) > MAX_SESSION_RESOLUTION_BYTES {
            return Ok(SessionResolution::Limited);
        }
        let Ok((text, _)) = read_capped_file(&path) else {
            continue;
        };
        scanned_bytes = scanned_bytes.saturating_add(text.len() as u64);
        for line in text.lines().filter(|line| line.len() <= MAX_LINE_BYTES) {
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if value_contains_session_id(&value, session_id) {
                return Ok(SessionResolution::Found(transcript.id.clone()));
            }
        }
    }
    if discovery_limited {
        Ok(SessionResolution::Limited)
    } else {
        Ok(SessionResolution::NotFound)
    }
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

struct SessionMetadata {
    session_id: Option<String>,
    project: Option<String>,
}

fn session_metadata(value: &Value) -> Option<SessionMetadata> {
    let payload = value.get("payload").unwrap_or(value);
    let payload_type = payload
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| value.get("type").and_then(Value::as_str));
    if payload_type != Some("session_meta") {
        return None;
    }
    Some(SessionMetadata {
        session_id: string_field(payload, &["id", "session_id", "sessionId"])
            .map(|value| safe_text(&value, 256).0),
        project: string_field(payload, &["cwd", "project"])
            .map(|value| safe_text(&value, MAX_FIELD_BYTES).0),
    })
}

fn extract_message_text(value: &Value) -> (Option<String>, bool) {
    match value {
        Value::String(text) => {
            let (text, truncated) = safe_display_text(text, MAX_FIELD_BYTES);
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
            let (text, truncated) = safe_display_text(&parts.join("\n"), MAX_FIELD_BYTES);
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

fn safe_display_text(value: &str, max_bytes: usize) -> (String, bool) {
    let redacted = codex_redaction::redact_known_secrets(value);
    safe_text(&redacted, max_bytes)
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
