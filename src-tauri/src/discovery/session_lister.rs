/// Session listing with pagination — list sessions for a project with metadata.
use std::io::{BufRead, BufReader};
use std::path::Path;

use base64::Engine;
use regex::Regex;
use std::sync::LazyLock;

use crate::analytics::scan_session_light;
use crate::types::domain::{
    GlobalSession, PaginatedGlobalSessionsResult, PaginatedSessionsResult, Session,
    SessionsPaginationOptions,
};
use crate::types::jsonl::RawJsonlEntry;

use super::content_filter::has_non_noise_messages;
use super::ongoing_detector::detect_ongoing;
use super::path_decoder::{build_todo_path, decode_path, extract_base_dir, extract_project_name};
use super::subagent_locator::has_subagents;
use super::subproject_registry::SubprojectRegistry;

/// List sessions for a project with cursor-based pagination.
pub fn list_sessions_paginated(
    projects_dir: &Path,
    claude_dir: &Path,
    project_id: &str,
    cursor: Option<&str>,
    limit: usize,
    options: &SessionsPaginationOptions,
    registry: &SubprojectRegistry,
) -> Result<PaginatedSessionsResult, String> {
    let base_dir = extract_base_dir(project_id);
    let project_dir = projects_dir.join(base_dir);

    if !project_dir.exists() {
        return Ok(PaginatedSessionsResult {
            sessions: vec![],
            next_cursor: None,
            has_more: false,
            total_count: 0,
        });
    }

    // Get session filter for composite IDs
    let session_filter = registry.get_session_filter(project_id);

    // Collect session files with metadata
    let entries = std::fs::read_dir(&project_dir)
        .map_err(|e| format!("Failed to read {}: {e}", project_dir.display()))?;

    let mut session_files: Vec<(String, f64, u64)> = Vec::new(); // (session_id, mtime_ms, size)

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        if !file_name_str.ends_with(".jsonl") || file_name_str.starts_with("agent_") {
            continue;
        }

        let session_id = file_name_str.trim_end_matches(".jsonl").to_string();

        // Apply subproject filter
        if let Some(filter) = session_filter {
            if !filter.contains(&session_id) {
                continue;
            }
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);

        let size = metadata.len();

        // Filter noise-only sessions if requested
        if options.prefilter_all && size > 0 {
            let file_path = entry.path();
            if !has_non_noise_messages(&file_path) {
                continue;
            }
        }

        session_files.push((session_id, mtime_ms, size));
    }

    // Sort by mtime descending
    session_files.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let total_count = session_files.len() as u32;

    // Apply cursor
    let start_index = if let Some(cursor_str) = cursor {
        parse_cursor(cursor_str, &session_files).unwrap_or(0)
    } else {
        0
    };

    // Paginate
    let page: Vec<_> = session_files.iter().skip(start_index).take(limit).collect();

    let has_more = start_index + limit < session_files.len();
    let next_cursor = if has_more {
        session_files
            .get(start_index + limit)
            .map(|(id, ts, _)| encode_cursor(*ts, id))
    } else {
        None
    };

    // Build session metadata
    let decoded_path = decode_path(base_dir);
    let project_name = extract_project_name(base_dir, None);
    let _ = project_name; // Used for display but not needed in Session struct

    let sessions: Vec<Session> = page
        .iter()
        .map(|(session_id, mtime_ms, _size)| {
            let created_at = *mtime_ms;

            // Load todo data
            let todo_data = load_todo_data(claude_dir, session_id);

            // Check for subagents
            let has_subs = has_subagents(projects_dir, project_id, session_id);

            let file_path = project_dir.join(format!("{session_id}.jsonl"));
            let preview = extract_session_preview(&file_path);
            let is_ongoing = detect_ongoing(&file_path);

            Session {
                id: session_id.clone(),
                project_id: project_id.to_string(),
                project_path: decoded_path.clone(),
                todo_data,
                created_at,
                first_message: preview.first_message.as_ref().map(|p| p.text.clone()),
                message_timestamp: preview.first_message.as_ref().map(|p| p.timestamp.clone()),
                has_subagents: has_subs,
                message_count: 0,
                cost_usd: None,
                is_ongoing,
                git_branch: None,
                metadata_level: Some("light".to_string()),
                context_consumption: None,
                compaction_count: None,
                phase_breakdown: None,
                custom_title: preview.custom_title,
                agent_name: preview.agent_name,
            }
        })
        .collect();

    Ok(PaginatedSessionsResult {
        sessions,
        next_cursor,
        has_more,
        total_count,
    })
}

#[derive(Debug)]
struct GlobalSessionCandidate {
    project_id: String,
    session_id: String,
    modified_at: f64,
    path: std::path::PathBuf,
}

pub fn list_global_sessions_paginated(
    projects_dir: &Path,
    cursor: Option<&str>,
    limit: usize,
) -> Result<PaginatedGlobalSessionsResult, String> {
    if !(1..=100).contains(&limit) {
        return Err("global sessions limit must be between 1 and 100".to_string());
    }
    let mut candidates = Vec::new();
    let project_entries = std::fs::read_dir(projects_dir)
        .map_err(|error| format!("Failed to read {}: {error}", projects_dir.display()))?;

    for project_entry in project_entries {
        let project_entry = project_entry.map_err(|error| {
            format!(
                "Failed to read entry in {}: {error}",
                projects_dir.display()
            )
        })?;
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let project_id = project_entry.file_name().to_string_lossy().into_owned();
        let session_entries = std::fs::read_dir(&project_path)
            .map_err(|error| format!("Failed to read {}: {error}", project_path.display()))?;
        for session_entry in session_entries {
            let session_entry = session_entry.map_err(|error| {
                format!(
                    "Failed to read entry in {}: {error}",
                    project_path.display()
                )
            })?;
            let file_name = session_entry.file_name().to_string_lossy().into_owned();
            if !file_name.ends_with(".jsonl") || file_name.starts_with("agent_") {
                continue;
            }
            let metadata = session_entry.metadata().map_err(|error| {
                format!(
                    "Failed to read metadata for {}: {error}",
                    session_entry.path().display()
                )
            })?;
            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            candidates.push(GlobalSessionCandidate {
                project_id: project_id.clone(),
                session_id: file_name.trim_end_matches(".jsonl").to_string(),
                modified_at,
                path: session_entry.path(),
            });
        }
    }

    candidates.sort_by(|left, right| {
        right
            .modified_at
            .total_cmp(&left.modified_at)
            .then_with(|| left.project_id.cmp(&right.project_id))
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    let start = match cursor {
        None => 0,
        Some(raw_cursor) => {
            let decoded = decode_global_cursor(raw_cursor)
                .ok_or_else(|| "invalid global sessions cursor".to_string())?;
            candidates
                .iter()
                .position(|candidate| {
                    candidate.modified_at.to_bits() == decoded.0.to_bits()
                        && candidate.project_id == decoded.1
                        && candidate.session_id == decoded.2
                })
                .map(|index| index + 1)
                .ok_or_else(|| "global sessions cursor is no longer available".to_string())?
        }
    };
    let end = start.saturating_add(limit).min(candidates.len());
    let has_more = end < candidates.len();
    let mut sessions = Vec::with_capacity(end.saturating_sub(start));

    for candidate in &candidates[start..end] {
        let Some(summary) = scan_session_light(&candidate.path) else {
            continue;
        };
        let project_path = decode_path(&candidate.project_id);
        if let Some(diagnostic) = summary.cost_diagnostic.as_deref() {
            eprintln!(
                "Light session scan cost unavailable for {}/{}: {diagnostic}",
                candidate.project_id, candidate.session_id
            );
        }
        sessions.push(GlobalSession {
            id: candidate.session_id.clone(),
            project_id: candidate.project_id.clone(),
            project_name: extract_project_name(&candidate.project_id, None),
            project_path,
            created_at: candidate.modified_at,
            first_message: summary.first_user_text,
            message_timestamp: summary.first_timestamp,
            message_count: summary.message_count,
            custom_title: summary.custom_title,
            agent_name: summary.agent_name,
            model: summary.model,
            cost_usd: summary.cost_usd,
        });
    }

    let next_cursor = has_more
        .then(|| {
            candidates.get(end.saturating_sub(1)).map(|candidate| {
                encode_global_cursor(
                    candidate.modified_at,
                    &candidate.project_id,
                    &candidate.session_id,
                )
            })
        })
        .flatten();
    Ok(PaginatedGlobalSessionsResult {
        sessions,
        next_cursor,
        has_more,
    })
}

fn encode_global_cursor(timestamp: f64, project_id: &str, session_id: &str) -> String {
    let raw = format!("{}:{project_id}:{session_id}", timestamp.to_bits());
    base64::engine::general_purpose::STANDARD.encode(raw)
}

fn decode_global_cursor(cursor: &str) -> Option<(f64, String, String)> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(cursor)
        .ok()?;
    let raw = String::from_utf8(decoded).ok()?;
    let mut parts = raw.splitn(3, ':');
    let timestamp = f64::from_bits(parts.next()?.parse().ok()?);
    Some((
        timestamp,
        parts.next()?.to_string(),
        parts.next()?.to_string(),
    ))
}

// First user message extraction

struct SessionPreview {
    first_message: Option<MessagePreview>,
    custom_title: Option<String>,
    agent_name: Option<String>,
}

struct MessagePreview {
    text: String,
    timestamp: String,
}

/// Tags that indicate command output / noise (not real user input).
const NOISE_PREFIXES: &[&str] = &[
    "<local-command-stdout>",
    "<local-command-stderr>",
    "<local-command-caveat>",
    "<system-reminder>",
    "[Request interrupted by user",
];

static COMMAND_NAME_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<command-name>/([^<]+)</command-name>").unwrap());

/// Sanitize display content by stripping XML-like wrapper tags.
/// Simplified version of the TypeScript sanitizeDisplayContent.
static STRIP_TAGS_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());

fn sanitize_display_content(text: &str) -> String {
    // Remove common wrapper tags but keep the inner content
    let result = text
        .replace("<command-name>", "")
        .replace("</command-name>", "")
        .replace("<command-args>", "")
        .replace("</command-args>", "");

    // For simple text without remaining tags, return as-is
    if !result.contains('<') {
        return result.trim().to_string();
    }

    // Strip remaining XML-like tags
    STRIP_TAGS_REGEX.replace_all(&result, "").trim().to_string()
}

/// Extract session preview: first user message, custom title, and agent name.
/// Scans up to 200 lines.
fn extract_session_preview(file_path: &Path) -> SessionPreview {
    let file = match std::fs::File::open(file_path) {
        Ok(f) => f,
        Err(_) => {
            return SessionPreview {
                first_message: None,
                custom_title: None,
                agent_name: None,
            }
        }
    };
    let reader = BufReader::new(file);

    let mut command_fallback: Option<MessagePreview> = None;
    let mut first_message: Option<MessagePreview> = None;
    let mut custom_title: Option<String> = None;
    let mut agent_name: Option<String> = None;
    let mut lines_read = 0;
    const MAX_LINES: usize = 200;

    for line in reader.lines() {
        if lines_read >= MAX_LINES {
            break;
        }
        lines_read += 1;

        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        let entry: RawJsonlEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Pick up metadata entries
        match entry.entry_type.as_str() {
            "custom-title" => {
                if let Some(ref title) = entry.custom_title {
                    custom_title = Some(title.clone());
                }
                continue;
            }
            "agent-name" => {
                if let Some(ref name) = entry.agent_name {
                    agent_name = Some(name.clone());
                }
                continue;
            }
            _ => {}
        }

        // Only look for first message if we haven't found one yet
        if first_message.is_some() {
            continue;
        }

        if entry.entry_type != "user" || entry.is_meta == Some(true) {
            continue;
        }

        let timestamp = entry.timestamp.unwrap_or_default();

        let msg = match entry.message.as_ref() {
            Some(m) => m,
            None => continue,
        };
        let content = match msg.get("content") {
            Some(c) => c,
            None => continue,
        };

        let text = match content {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Array(blocks) => blocks
                .iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(" "),
            _ => continue,
        };

        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }

        let is_noise = NOISE_PREFIXES.iter().any(|p| trimmed.starts_with(p));
        if is_noise {
            continue;
        }

        if trimmed.starts_with("<command-name>") {
            let cmd_text = if let Some(caps) = COMMAND_NAME_REGEX.captures(trimmed) {
                format!("/{}", &caps[1])
            } else {
                "/command".to_string()
            };

            if command_fallback.is_none() {
                command_fallback = Some(MessagePreview {
                    text: cmd_text,
                    timestamp: timestamp.clone(),
                });
            }
            continue;
        }

        let sanitized = sanitize_display_content(trimmed);
        if sanitized.is_empty() {
            continue;
        }

        let preview_text = if sanitized.len() > 500 {
            // Find a valid UTF-8 char boundary at or before byte 500
            let mut end = 500;
            while !sanitized.is_char_boundary(end) {
                end -= 1;
            }
            sanitized[..end].to_string()
        } else {
            sanitized
        };

        first_message = Some(MessagePreview {
            text: preview_text,
            timestamp,
        });
    }

    SessionPreview {
        first_message: first_message.or(command_fallback),
        custom_title,
        agent_name,
    }
}

// Todo data loading

/// Load todo data from ~/.claude/todos/{sessionId}.json.
fn load_todo_data(claude_dir: &Path, session_id: &str) -> Option<serde_json::Value> {
    let todo_path = build_todo_path(claude_dir, session_id);
    if !todo_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&todo_path).ok()?;
    serde_json::from_str(&content).ok()
}

// Cursor encoding/decoding

/// Encode a pagination cursor as base64.
fn encode_cursor(timestamp: f64, session_id: &str) -> String {
    let raw = format!("{timestamp}:{session_id}");
    base64::engine::general_purpose::STANDARD.encode(raw.as_bytes())
}

/// Parse a cursor and return the start index in the sorted session list.
fn parse_cursor(cursor: &str, sessions: &[(String, f64, u64)]) -> Option<usize> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(cursor)
        .ok()?;
    let raw = String::from_utf8(decoded).ok()?;
    let parts: Vec<&str> = raw.splitn(2, ':').collect();
    if parts.len() != 2 {
        return None;
    }

    let cursor_ts: f64 = parts[0].parse().ok()?;
    let cursor_id = parts[1];

    // Find the position after the cursor
    for (i, (id, ts, _)) in sessions.iter().enumerate() {
        if (*ts - cursor_ts).abs() < 1.0 && id == cursor_id {
            return Some(i);
        }
        // Since sorted by mtime desc, if we've passed the cursor timestamp,
        // start from here
        if *ts < cursor_ts {
            return Some(i);
        }
    }

    Some(sessions.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    static GLOBAL_LIST_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn global_lister_pages_across_projects_without_duplicates() {
        let _guard = GLOBAL_LIST_TEST_LOCK.lock().expect("lock tests");
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("claude-devtools-global-list-{unique}"));
        let fixture = r#"{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"role":"assistant","model":"claude-sonnet-4","usage":{"input_tokens":1}}}"#;
        for (project, session) in [("-tmp-alpha", "a"), ("-tmp-beta", "b")] {
            let project_dir = root.join(project);
            std::fs::create_dir_all(&project_dir).expect("create project");
            std::fs::write(project_dir.join(format!("{session}.jsonl")), fixture)
                .expect("write session");
        }

        let first = list_global_sessions_paginated(&root, None, 1).expect("first page");
        let second = list_global_sessions_paginated(&root, first.next_cursor.as_deref(), 1)
            .expect("second page");
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(first.sessions.len(), 1);
        assert!(first.has_more);
        assert_eq!(second.sessions.len(), 1);
        assert!(!second.has_more);
        assert_ne!(first.sessions[0].id, second.sessions[0].id);
    }

    #[test]
    fn global_lister_enriches_only_current_page() {
        let _guard = GLOBAL_LIST_TEST_LOCK.lock().expect("lock tests");
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("claude-devtools-page-scan-{unique}"));
        let project_dir = root.join("-tmp-alpha");
        std::fs::create_dir_all(&project_dir).expect("create project");
        let fixture = r#"{"type":"user","message":{"role":"user","content":"hello"}}"#;
        for session in ["a", "b", "c"] {
            std::fs::write(project_dir.join(format!("{session}.jsonl")), fixture)
                .expect("write session");
        }

        crate::analytics::reset_light_scan_count();
        let page = list_global_sessions_paginated(&root, None, 1).expect("page");
        let scan_count = crate::analytics::light_scan_count();
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(page.sessions.len(), 1);
        assert_eq!(scan_count, 1);
        assert!(page.has_more);
    }

    #[test]
    fn global_lister_rejects_out_of_range_limits_before_reading() {
        let missing = Path::new("/definitely/missing");
        assert_eq!(
            list_global_sessions_paginated(missing, None, 0).expect_err("zero limit"),
            "global sessions limit must be between 1 and 100"
        );
        assert_eq!(
            list_global_sessions_paginated(missing, None, 101).expect_err("large limit"),
            "global sessions limit must be between 1 and 100"
        );
    }

    #[test]
    fn global_cursor_round_trips_exact_timestamp_bits() {
        let cursor = encode_global_cursor(1_234.5, "project", "session");
        assert_eq!(
            decode_global_cursor(&cursor),
            Some((1_234.5, "project".to_string(), "session".to_string()))
        );
    }
}
