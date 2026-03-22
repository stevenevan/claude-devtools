/// Full session file parsing — streaming JSONL reader and message categorization.

use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::types::domain::{MessagesByType, ParsedSession};
use crate::types::jsonl::RawJsonlEntry;
use crate::types::messages::{ParsedMessage, ToolCall};

use super::entry_parser::parse_entry;
use super::message_classifier::is_parsed_real_user_message;
use super::metrics::calculate_metrics;

/// Parse a JSONL session file into a Vec<ParsedMessage>.
/// Streams line-by-line to avoid loading the entire file into memory.
pub fn parse_jsonl_file(file_path: &Path) -> Result<Vec<ParsedMessage>, String> {
    if !file_path.exists() {
        return Ok(vec![]);
    }

    let file =
        std::fs::File::open(file_path).map_err(|e| format!("Failed to open {}: {e}", file_path.display()))?;

    let reader = BufReader::new(file);
    let mut messages = Vec::new();

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

        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<RawJsonlEntry>(&line) {
            Ok(entry) => {
                if let Some(msg) = parse_entry(&entry) {
                    messages.push(msg);
                }
            }
            Err(e) => {
                eprintln!(
                    "[parser] Error parsing JSON in {}: {e}",
                    file_path.display()
                );
            }
        }
    }

    Ok(messages)
}

/// Process parsed messages into a full ParsedSession with categorized fields.
pub fn process_messages(messages: Vec<ParsedMessage>) -> ParsedSession {
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
    let messages = parse_jsonl_file(file_path)?;
    Ok(process_messages(messages))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_parse_jsonl_file_nonexistent() {
        let result = parse_jsonl_file(Path::new("/nonexistent/file.jsonl")).unwrap();
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

        let messages = parse_jsonl_file(&file_path).unwrap();
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
            },
        ];

        let session = process_messages(msgs);
        assert_eq!(session.by_type.user.len(), 1);
        assert_eq!(session.by_type.real_user.len(), 1);
        assert_eq!(session.main_messages.len(), 1);
        assert_eq!(session.sidechain_messages.len(), 0);
    }
}
