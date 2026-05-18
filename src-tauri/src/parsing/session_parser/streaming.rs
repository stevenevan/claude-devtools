/// Streaming JSONL reader — line-by-line parsing.
///
/// `parse_jsonl_line` is the shared core used by both full and incremental
/// readers. `parse_jsonl_file` walks an entire file from the beginning.
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::types::jsonl::RawJsonlEntry;
use crate::types::messages::ParsedMessage;

use super::super::entry_parser::parse_entry;

/// Hard cap on a single JSONL line before it reaches serde_json (sprint 56).
/// A pathological producer cannot make us allocate gigabytes of contiguous heap
/// or stall parsing for minutes — over-cap lines are dropped with a structured
/// error log and the file continues.
pub const MAX_JSONL_LINE_BYTES: usize = 10 * 1024 * 1024;

/// Session-level metadata extracted from non-message JSONL entries.
#[derive(Debug, Clone, Default)]
pub struct SessionFileMetadata {
    pub custom_title: Option<String>,
    pub agent_name: Option<String>,
}

/// Result of parsing JSONL lines — messages plus metadata updates.
pub struct LineParseResult {
    pub messages: Vec<ParsedMessage>,
    pub metadata: SessionFileMetadata,
}

/// Shared per-line parser used by both full and incremental readers.
pub fn parse_jsonl_line(line: &str, metadata: &mut SessionFileMetadata) -> Option<ParsedMessage> {
    if line.trim().is_empty() {
        return None;
    }
    if line.len() > MAX_JSONL_LINE_BYTES {
        tracing::warn!(
            target: "parser",
            line_bytes = line.len(),
            cap_bytes = MAX_JSONL_LINE_BYTES,
            "dropping oversized JSONL line"
        );
        return None;
    }

    match serde_json::from_str::<RawJsonlEntry>(line) {
        Ok(entry) => {
            match entry.entry_type.as_str() {
                "custom-title" => {
                    if let Some(ref title) = entry.custom_title {
                        metadata.custom_title = Some(title.clone());
                    }
                }
                "agent-name" => {
                    if let Some(ref name) = entry.agent_name {
                        metadata.agent_name = Some(name.clone());
                    }
                }
                _ => {}
            }

            parse_entry(&entry)
        }
        Err(_) => None,
    }
}

/// Streams line-by-line to avoid loading the entire file into memory.
pub fn parse_jsonl_file(
    file_path: &Path,
) -> Result<(Vec<ParsedMessage>, SessionFileMetadata), String> {
    if !file_path.exists() {
        return Ok((vec![], SessionFileMetadata::default()));
    }

    let file =
        std::fs::File::open(file_path).map_err(|e| format!("failed to open session file: {e}"))?;

    let reader = BufReader::new(file);
    let mut messages = Vec::new();
    let mut metadata = SessionFileMetadata::default();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!(
                    target: "parser",
                    path = %crate::logging::Redact(file_path),
                    error = %e,
                    "error reading line"
                );
                continue;
            }
        };

        if let Some(msg) = parse_jsonl_line(&line, &mut metadata) {
            messages.push(msg);
        }
    }

    Ok((messages, metadata))
}

#[cfg(test)]
#[path = "streaming_tests.rs"]
mod tests;
