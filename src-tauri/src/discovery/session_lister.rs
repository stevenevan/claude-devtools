/// Session listing with pagination — list sessions for a project with metadata.

use std::io::{BufRead, BufReader};
use std::path::Path;

use base64::Engine;
use regex::Regex;
use std::sync::LazyLock;

use crate::types::domain::{PaginatedSessionsResult, Session, SessionsPaginationOptions};
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
    let page: Vec<_> = session_files
        .iter()
        .skip(start_index)
        .take(limit)
        .collect();

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

            // Extract first user message preview
            let file_path = project_dir.join(format!("{session_id}.jsonl"));
            let preview = extract_first_user_message(&file_path);

            // Detect if session is currently active
            let is_ongoing = detect_ongoing(&file_path);

            Session {
                id: session_id.clone(),
                project_id: project_id.to_string(),
                project_path: decoded_path.clone(),
                todo_data,
                created_at,
                first_message: preview.as_ref().map(|p| p.text.clone()),
                message_timestamp: preview.as_ref().map(|p| p.timestamp.clone()),
                has_subagents: has_subs,
                message_count: 0,
                is_ongoing,
                git_branch: None,
                metadata_level: Some("light".to_string()),
                context_consumption: None,
                compaction_count: None,
                phase_breakdown: None,
                custom_title: None,
                agent_name: None,
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

// =============================================================================
// First user message extraction
// =============================================================================

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
static STRIP_TAGS_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());

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

/// Extract first user message preview from a session file.
/// Scans up to 200 lines to find the first non-noise user message.
fn extract_first_user_message(file_path: &Path) -> Option<MessagePreview> {
    let file = std::fs::File::open(file_path).ok()?;
    let reader = BufReader::new(file);

    let mut command_fallback: Option<MessagePreview> = None;
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

        if entry.entry_type != "user" {
            continue;
        }

        // Skip meta messages (tool results)
        if entry.is_meta == Some(true) {
            continue;
        }

        let timestamp = entry.timestamp.unwrap_or_default();

        // Extract content from message
        let msg = entry.message.as_ref()?;
        let content = msg.get("content")?;

        let text = match content {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Array(blocks) => {
                // Join text blocks
                blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            _ => continue,
        };

        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Skip noise
        let is_noise = NOISE_PREFIXES.iter().any(|p| trimmed.starts_with(p));
        if is_noise {
            continue;
        }

        // Command-style message: <command-name>/foo</command-name>
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

        // Real user message — sanitize and return
        let sanitized = sanitize_display_content(trimmed);
        if sanitized.is_empty() {
            continue;
        }

        let preview_text = if sanitized.len() > 500 {
            sanitized[..500].to_string()
        } else {
            sanitized
        };

        return Some(MessagePreview {
            text: preview_text,
            timestamp,
        });
    }

    command_fallback
}

// =============================================================================
// Todo data loading
// =============================================================================

/// Load todo data from ~/.claude/todos/{sessionId}.json.
fn load_todo_data(claude_dir: &Path, session_id: &str) -> Option<serde_json::Value> {
    let todo_path = build_todo_path(claude_dir, session_id);
    if !todo_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&todo_path).ok()?;
    serde_json::from_str(&content).ok()
}

// =============================================================================
// Cursor encoding/decoding
// =============================================================================

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
