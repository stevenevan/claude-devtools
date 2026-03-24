/// Full session file parsing — streaming JSONL reader and message categorization.

use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use crate::types::domain::{MessagesByType, ParsedSession};
use crate::types::jsonl::RawJsonlEntry;
use crate::types::messages::{ParsedMessage, ToolCall};

use super::entry_parser::parse_entry;
use super::message_classifier::is_parsed_real_user_message;
use super::metrics::calculate_metrics;

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

/// Parse a single JSONL line into an optional message and metadata update.
/// This is the shared core used by both full and incremental parsing.
pub fn parse_jsonl_line(line: &str, metadata: &mut SessionFileMetadata) -> Option<ParsedMessage> {
    if line.trim().is_empty() {
        return None;
    }

    match serde_json::from_str::<RawJsonlEntry>(line) {
        Ok(entry) => {
            // Extract session-level metadata from non-message entries
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

/// Parse a JSONL session file into messages and session metadata.
/// Streams line-by-line to avoid loading the entire file into memory.
pub fn parse_jsonl_file(file_path: &Path) -> Result<(Vec<ParsedMessage>, SessionFileMetadata), String> {
    if !file_path.exists() {
        return Ok((vec![], SessionFileMetadata::default()));
    }

    let file =
        std::fs::File::open(file_path).map_err(|e| format!("Failed to open {}: {e}", file_path.display()))?;

    let reader = BufReader::new(file);
    let mut messages = Vec::new();
    let mut metadata = SessionFileMetadata::default();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!(
                    "[parser] Error reading line in {}: {e}",
                    file_path.display()
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

/// Parse a JSONL file incrementally starting from `byte_offset`.
/// Returns new messages, updated metadata, and the new byte offset.
/// Handles partial lines (from mid-write) by not advancing past an incomplete last line.
pub fn parse_jsonl_incremental(
    file_path: &Path,
    byte_offset: u64,
    existing_metadata: &SessionFileMetadata,
) -> Result<(Vec<ParsedMessage>, SessionFileMetadata, u64), String> {
    if !file_path.exists() {
        return Ok((vec![], existing_metadata.clone(), byte_offset));
    }

    let mut file =
        std::fs::File::open(file_path).map_err(|e| format!("Failed to open {}: {e}", file_path.display()))?;

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

/// Process parsed messages into a full ParsedSession with categorized fields.
pub fn process_messages(messages: Vec<ParsedMessage>, metadata: SessionFileMetadata) -> ParsedSession {
    let metrics = calculate_metrics(&messages);
    let task_calls = get_task_calls(&messages);

    let mut by_type = MessagesByType {
        user: Vec::new(),
        real_user: Vec::new(),
        internal_user: Vec::new(),
        assistant: Vec::new(),
        system: Vec::new(),
        other: Vec::new(),
    };

    let mut sidechain_messages = Vec::new();
    let mut main_messages = Vec::new();

    for msg in &messages {
        // Categorize by type
        match msg.message_type.as_str() {
            "user" => {
                by_type.user.push(msg.clone());
                if is_parsed_real_user_message(msg) {
                    by_type.real_user.push(msg.clone());
                }
                if msg.is_meta {
                    by_type.internal_user.push(msg.clone());
                }
            }
            "assistant" => {
                by_type.assistant.push(msg.clone());
            }
            "system" => {
                by_type.system.push(msg.clone());
            }
            _ => {
                by_type.other.push(msg.clone());
            }
        }

        // Separate sidechain vs main
        if msg.is_sidechain {
            sidechain_messages.push(msg.clone());
        } else {
            main_messages.push(msg.clone());
        }
    }

    ParsedSession {
        messages,
        metrics,
        task_calls,
        by_type,
        sidechain_messages,
        main_messages,
        custom_title: metadata.custom_title,
        agent_name: metadata.agent_name,
    }
}

/// Extract all Task tool calls from messages.
fn get_task_calls(messages: &[ParsedMessage]) -> Vec<ToolCall> {
    messages
        .iter()
        .flat_map(|m| m.tool_calls.iter().filter(|tc| tc.is_task).cloned())
        .collect()
}

/// Parse a session file and return a fully processed ParsedSession.
pub fn parse_session_file(file_path: &Path) -> Result<ParsedSession, String> {
    let (messages, metadata) = parse_jsonl_file(file_path)?;
    Ok(process_messages(messages, metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_parse_jsonl_file_nonexistent() {
        let (result, _) = parse_jsonl_file(Path::new("/nonexistent/file.jsonl")).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_jsonl_file_with_content() {
        let dir = std::env::temp_dir().join("claude-devtools-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("test_session.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/tmp","sessionId":"s1","version":"1","gitBranch":"main","message":{{"role":"user","content":"hello"}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"assistant","uuid":"a1","parentUuid":"u1","isSidechain":false,"userType":"external","cwd":"/tmp","sessionId":"s1","version":"1","gitBranch":"main","requestId":"req1","message":{{"role":"assistant","model":"claude-sonnet-4-20250514","id":"msg1","type":"message","content":[{{"type":"text","text":"Hi!"}}],"stop_reason":"end_turn","stop_sequence":null,"usage":{{"input_tokens":100,"output_tokens":50}}}}}}"#
        )
        .unwrap();

        let (messages, _) = parse_jsonl_file(&file_path).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[1].message_type, "assistant");

        // Clean up
        let _ = std::fs::remove_file(&file_path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn test_process_messages_categorization() {
        let msgs = vec![
            ParsedMessage {
                uuid: "u1".to_string(),
                parent_uuid: None,
                message_type: "user".to_string(),
                timestamp: "2024-01-01T00:00:00Z".to_string(),
                role: Some("user".to_string()),
                content: crate::types::messages::ParsedMessageContent::Text(
                    "hello".to_string(),
                ),
                usage: None,
                model: None,
                cwd: None,
                git_branch: None,
                agent_id: None,
                is_sidechain: false,
                is_meta: false,
                user_type: None,
                tool_calls: vec![],
                tool_results: vec![],
                source_tool_use_id: None,
                source_tool_assistant_uuid: None,
                tool_use_result: None,
                is_compact_summary: None,
                request_id: None,
                subtype: None,
                event_data: None,
            },
        ];

        let session = process_messages(msgs, SessionFileMetadata::default());
        assert_eq!(session.by_type.user.len(), 1);
        assert_eq!(session.by_type.real_user.len(), 1);
        assert_eq!(session.main_messages.len(), 1);
        assert_eq!(session.sidechain_messages.len(), 0);
    }
}
