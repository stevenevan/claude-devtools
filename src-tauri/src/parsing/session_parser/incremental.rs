/// Incremental JSONL parsing — read only the bytes appended since the
/// last call by seeking from a stored `byte_offset`.
///
/// Handles partial lines (from mid-write) by not advancing past an
/// incomplete trailing line.
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use crate::types::messages::ParsedMessage;

use super::streaming::{SessionFileMetadata, parse_jsonl_line};

/// Parse a JSONL file incrementally starting from `byte_offset`.
/// Returns new messages, updated metadata, and the new byte offset.
pub fn parse_jsonl_incremental(
    file_path: &Path,
    byte_offset: u64,
    existing_metadata: &SessionFileMetadata,
) -> Result<(Vec<ParsedMessage>, SessionFileMetadata, u64), String> {
    if !file_path.exists() {
        return Ok((vec![], existing_metadata.clone(), byte_offset));
    }

    let mut file =
        std::fs::File::open(file_path).map_err(|e| format!("failed to open session file: {e}"))?;

    let file_len = file
        .metadata()
        .map_err(|e| format!("Failed to get file metadata: {e}"))?
        .len();

    // Nothing new to read
    if file_len <= byte_offset {
        return Ok((vec![], existing_metadata.clone(), byte_offset));
    }

    file.seek(SeekFrom::Start(byte_offset))
        .map_err(|e| format!("Failed to seek: {e}"))?;

    let reader = BufReader::new(file);
    let mut messages = Vec::new();
    let mut metadata = existing_metadata.clone();
    let mut current_offset = byte_offset;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => {
                // Likely a partial line from a concurrent write — stop here.
                // Don't advance the offset past this incomplete line.
                break;
            }
        };

        // Advance offset by line length + newline byte
        current_offset += line.len() as u64 + 1;

        if let Some(msg) = parse_jsonl_line(&line, &mut metadata) {
            messages.push(msg);
        }
    }

    Ok((messages, metadata, current_offset))
}

#[cfg(test)]
#[path = "incremental_tests.rs"]
mod tests;
