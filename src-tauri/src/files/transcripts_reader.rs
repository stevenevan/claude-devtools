//! Read-only browser for `<root>/transcripts/ses_*.jsonl` subagent
//! transcripts. Listing reuses the shipped stat-only `claude_read::list_dir_files`
//! (no per-file open); `read_transcript` parses each line tolerantly.

use serde::Serialize;

use crate::files::claude_read;

/// Bytes above which `content`/`tool_input`/`tool_output` are truncated with
/// a `…[truncated N bytes]` marker. Real transcripts reach 25 MB with 300 KB+
/// single records, so the payload must be bounded before it ships over IPC.
const TRUNCATE_BYTES: usize = 64 * 1024;

// confirm-at-impl: each transcript line is assumed to be a flat 3-type log —
// `user {content, timestamp}`, `tool_use {tool_name, tool_input, timestamp}`,
// `tool_result {tool_name, tool_input, tool_output, timestamp}` — with
// `timestamp` an ISO-8601 string, not an integer. No `.message` envelope, no
// assistant/thinking blocks: `parse_session_file` is incompatible.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptRecord {
    pub kind: String,
    pub timestamp: Option<String>,
    pub content: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub tool_output: Option<String>,
    pub truncated: bool,
}

/// Truncates `s` to at most `TRUNCATE_BYTES` bytes at the nearest char
/// boundary (never slices mid-UTF8), appending a marker and flipping
/// `*truncated` when it does. Returns `s` unchanged otherwise.
fn truncate_field(s: String, truncated: &mut bool) -> String {
    if s.len() <= TRUNCATE_BYTES {
        return s;
    }
    let mut idx = TRUNCATE_BYTES;
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    *truncated = true;
    format!("{}…[truncated {} bytes]", &s[..idx], s.len() - idx)
}

/// Reads `<root>/transcripts/<id>`, traversal-safe, and parses each
/// non-empty line tolerantly. Never deserializes a line directly into
/// `TranscriptRecord`: a present-but-wrong-type field (e.g. the string
/// `timestamp`) would drop the whole record under a typed struct, so each
/// line is parsed to `serde_json::Value` and fields are extracted by key.
pub fn read_transcript(root: &str, id: &str) -> Result<Vec<TranscriptRecord>, String> {
    let is_unsafe = |s: &str| s.contains('/') || s.contains('\\') || s.contains("..");
    if is_unsafe(id) || !id.starts_with("ses_") || !id.ends_with(".jsonl") {
        return Err("files: invalid id".to_string());
    }

    let bytes = claude_read::read_confined_file(root, "transcripts", id)?;
    let text = String::from_utf8_lossy(&bytes);

    let records = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .map(|value| {
            let kind = value["type"].as_str().unwrap_or("").to_string();
            let timestamp = value["timestamp"].as_str().map(str::to_string);
            let content = value["content"].as_str().map(str::to_string);
            let tool_name = value["tool_name"].as_str().map(str::to_string);
            let tool_input = value
                .get("tool_input")
                .filter(|v| !v.is_null())
                .map(|v| serde_json::to_string_pretty(v).unwrap_or_default());
            let tool_output = value
                .get("tool_output")
                .filter(|v| !v.is_null())
                .map(|v| serde_json::to_string_pretty(v).unwrap_or_default());

            let mut truncated = false;
            let content = content.map(|s| truncate_field(s, &mut truncated));
            let tool_input = tool_input.map(|s| truncate_field(s, &mut truncated));
            let tool_output = tool_output.map(|s| truncate_field(s, &mut truncated));

            TranscriptRecord {
                kind,
                timestamp,
                content,
                tool_name,
                tool_input,
                tool_output,
                truncated,
            }
        })
        .collect();

    Ok(records)
}

#[cfg(test)]
#[path = "transcripts_reader_tests.rs"]
mod transcripts_reader_tests;
