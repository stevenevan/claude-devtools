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

fn get_task_calls(messages: &[ParsedMessage]) -> Vec<ToolCall> {
    messages
        .iter()
        .flat_map(|m| m.tool_calls.iter().filter(|tc| tc.is_task).cloned())
        .collect()
}

pub fn parse_session_file(file_path: &Path) -> Result<ParsedSession, String> {
    let (messages, metadata) = parse_jsonl_file(file_path)?;
    Ok(process_messages(messages, metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::messages::{ParsedMessageContent, TokenUsage};
    use std::io::Write;

    /// Helper: create a temp directory with a unique name for test isolation.
    fn test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join("claude-devtools-test")
            .join(name);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Helper: build a minimal ParsedMessage.
    fn make_msg(uuid: &str, msg_type: &str, is_meta: bool, is_sidechain: bool) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: msg_type.to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some(msg_type.to_string()),
            content: ParsedMessageContent::Text("test".to_string()),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain,
            is_meta,
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
        }
    }

    // =========================================================================
    // parse_jsonl_line
    // =========================================================================

    #[test]
    fn test_parse_jsonl_line_empty_string() {
        let mut meta = SessionFileMetadata::default();
        assert!(parse_jsonl_line("", &mut meta).is_none());
    }

    #[test]
    fn test_parse_jsonl_line_whitespace_only() {
        let mut meta = SessionFileMetadata::default();
        assert!(parse_jsonl_line("   \t  ", &mut meta).is_none());
    }

    #[test]
    fn test_parse_jsonl_line_malformed_json() {
        let mut meta = SessionFileMetadata::default();
        assert!(parse_jsonl_line("{not valid json}", &mut meta).is_none());
    }

    #[test]
    fn test_parse_jsonl_line_valid_user_entry() {
        let mut meta = SessionFileMetadata::default();
        let line = r#"{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/tmp","sessionId":"s1","version":"1","gitBranch":"main","message":{"role":"user","content":"hello"}}"#;
        let msg = parse_jsonl_line(line, &mut meta).unwrap();
        assert_eq!(msg.message_type, "user");
        assert_eq!(msg.uuid, "u1");
    }

    #[test]
    fn test_parse_jsonl_line_custom_title_metadata() {
        let mut meta = SessionFileMetadata::default();
        let line = r#"{"type":"custom-title","customTitle":"My Session"}"#;
        let result = parse_jsonl_line(line, &mut meta);
        // custom-title is not a known message type, so no message returned
        assert!(result.is_none());
        assert_eq!(meta.custom_title.as_deref(), Some("My Session"));
    }

    #[test]
    fn test_parse_jsonl_line_agent_name_metadata() {
        let mut meta = SessionFileMetadata::default();
        let line = r#"{"type":"agent-name","agentName":"code-reviewer"}"#;
        let result = parse_jsonl_line(line, &mut meta);
        assert!(result.is_none());
        assert_eq!(meta.agent_name.as_deref(), Some("code-reviewer"));
    }

    #[test]
    fn test_parse_jsonl_line_unknown_type_skipped() {
        let mut meta = SessionFileMetadata::default();
        let line = r#"{"type":"unknown_thing","uuid":"x1"}"#;
        assert!(parse_jsonl_line(line, &mut meta).is_none());
    }

    // =========================================================================
    // parse_jsonl_file
    // =========================================================================

    #[test]
    fn test_parse_jsonl_file_nonexistent() {
        let (result, _) = parse_jsonl_file(Path::new("/nonexistent/file.jsonl")).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_jsonl_file_empty_file() {
        let dir = test_dir("empty_file");
        let file_path = dir.join("empty.jsonl");
        std::fs::File::create(&file_path).unwrap();

        let (messages, metadata) = parse_jsonl_file(&file_path).unwrap();
        assert!(messages.is_empty());
        assert!(metadata.custom_title.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_parse_jsonl_file_with_content() {
        let dir = test_dir("with_content");
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

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_parse_jsonl_file_skips_blank_lines() {
        let dir = test_dir("blank_lines");
        let file_path = dir.join("blanks.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(file, "").unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"hi"}}}}"#
        )
        .unwrap();
        writeln!(file, "").unwrap();
        writeln!(file, "   ").unwrap();

        let (messages, _) = parse_jsonl_file(&file_path).unwrap();
        assert_eq!(messages.len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_parse_jsonl_file_skips_malformed_lines() {
        let dir = test_dir("malformed_lines");
        let file_path = dir.join("mixed.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(file, "{{not json}}").unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"valid"}}}}"#
        )
        .unwrap();
        writeln!(file, "truncated{{").unwrap();

        let (messages, _) = parse_jsonl_file(&file_path).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].uuid, "u1");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_parse_jsonl_file_extracts_metadata() {
        let dir = test_dir("metadata");
        let file_path = dir.join("meta.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(
            file,
            r#"{{"type":"custom-title","customTitle":"Debug Session"}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"agent-name","agentName":"explorer"}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"go"}}}}"#
        )
        .unwrap();

        let (messages, metadata) = parse_jsonl_file(&file_path).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(metadata.custom_title.as_deref(), Some("Debug Session"));
        assert_eq!(metadata.agent_name.as_deref(), Some("explorer"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // =========================================================================
    // parse_jsonl_incremental
    // =========================================================================

    #[test]
    fn test_incremental_nonexistent_file() {
        let meta = SessionFileMetadata::default();
        let (msgs, _, offset) =
            parse_jsonl_incremental(Path::new("/nonexistent/file.jsonl"), 0, &meta).unwrap();
        assert!(msgs.is_empty());
        assert_eq!(offset, 0);
    }

    #[test]
    fn test_incremental_from_zero() {
        let dir = test_dir("incr_zero");
        let file_path = dir.join("session.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"first"}}}}"#
        )
        .unwrap();

        let meta = SessionFileMetadata::default();
        let (msgs, _, new_offset) = parse_jsonl_incremental(&file_path, 0, &meta).unwrap();
        assert_eq!(msgs.len(), 1);
        assert!(new_offset > 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_incremental_reads_only_new_lines() {
        let dir = test_dir("incr_new");
        let file_path = dir.join("session.jsonl");

        // Write first line
        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"first"}}}}"#
        )
        .unwrap();

        let meta = SessionFileMetadata::default();
        let (msgs1, meta1, offset1) = parse_jsonl_incremental(&file_path, 0, &meta).unwrap();
        assert_eq!(msgs1.len(), 1);

        // Append second line
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&file_path)
            .unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u2","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"second"}}}}"#
        )
        .unwrap();

        let (msgs2, _, offset2) = parse_jsonl_incremental(&file_path, offset1, &meta1).unwrap();
        assert_eq!(msgs2.len(), 1);
        assert_eq!(msgs2[0].uuid, "u2");
        assert!(offset2 > offset1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_incremental_no_new_data() {
        let dir = test_dir("incr_no_new");
        let file_path = dir.join("session.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"only"}}}}"#
        )
        .unwrap();

        let meta = SessionFileMetadata::default();
        let (_, meta1, offset1) = parse_jsonl_incremental(&file_path, 0, &meta).unwrap();

        // No new data — same offset
        let (msgs, _, offset2) = parse_jsonl_incremental(&file_path, offset1, &meta1).unwrap();
        assert!(msgs.is_empty());
        assert_eq!(offset1, offset2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_incremental_preserves_existing_metadata() {
        let dir = test_dir("incr_meta");
        let file_path = dir.join("session.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(
            file,
            r#"{{"type":"custom-title","customTitle":"My Title"}}"#
        )
        .unwrap();

        let meta = SessionFileMetadata::default();
        let (_, meta1, offset1) = parse_jsonl_incremental(&file_path, 0, &meta).unwrap();
        assert_eq!(meta1.custom_title.as_deref(), Some("My Title"));

        // Append a user message — metadata should carry forward
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&file_path)
            .unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"hi"}}}}"#
        )
        .unwrap();

        let (msgs, meta2, _) = parse_jsonl_incremental(&file_path, offset1, &meta1).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(meta2.custom_title.as_deref(), Some("My Title"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // =========================================================================
    // process_messages
    // =========================================================================

    #[test]
    fn test_process_messages_categorization() {
        let msgs = vec![make_msg("u1", "user", false, false)];

        let session = process_messages(msgs, SessionFileMetadata::default());
        assert_eq!(session.by_type.user.len(), 1);
        assert_eq!(session.by_type.real_user.len(), 1);
        assert_eq!(session.main_messages.len(), 1);
        assert_eq!(session.sidechain_messages.len(), 0);
    }

    #[test]
    fn test_process_messages_assistant_categorized() {
        let msgs = vec![make_msg("a1", "assistant", false, false)];
        let session = process_messages(msgs, SessionFileMetadata::default());
        assert_eq!(session.by_type.assistant.len(), 1);
        assert_eq!(session.by_type.user.len(), 0);
    }

    #[test]
    fn test_process_messages_system_categorized() {
        let msgs = vec![make_msg("s1", "system", false, false)];
        let session = process_messages(msgs, SessionFileMetadata::default());
        assert_eq!(session.by_type.system.len(), 1);
    }

    #[test]
    fn test_process_messages_unknown_type_goes_to_other() {
        let msgs = vec![make_msg("x1", "summary", false, false)];
        let session = process_messages(msgs, SessionFileMetadata::default());
        assert_eq!(session.by_type.other.len(), 1);
    }

    #[test]
    fn test_process_messages_sidechain_separation() {
        let msgs = vec![
            make_msg("u1", "user", false, false),
            make_msg("a1", "assistant", false, true),
        ];
        let session = process_messages(msgs, SessionFileMetadata::default());
        assert_eq!(session.main_messages.len(), 1);
        assert_eq!(session.sidechain_messages.len(), 1);
        assert_eq!(session.sidechain_messages[0].uuid, "a1");
    }

    #[test]
    fn test_process_messages_internal_user() {
        let msgs = vec![make_msg("u1", "user", true, false)];
        let session = process_messages(msgs, SessionFileMetadata::default());
        assert_eq!(session.by_type.user.len(), 1);
        assert_eq!(session.by_type.internal_user.len(), 1);
        // Meta user messages are NOT real user messages
        assert_eq!(session.by_type.real_user.len(), 0);
    }

    #[test]
    fn test_process_messages_metadata_propagation() {
        let meta = SessionFileMetadata {
            custom_title: Some("Test Title".to_string()),
            agent_name: Some("explorer".to_string()),
        };
        let session = process_messages(vec![], meta);
        assert_eq!(session.custom_title.as_deref(), Some("Test Title"));
        assert_eq!(session.agent_name.as_deref(), Some("explorer"));
    }

    #[test]
    fn test_process_messages_empty() {
        let session = process_messages(vec![], SessionFileMetadata::default());
        assert!(session.messages.is_empty());
        assert_eq!(session.metrics.total_tokens, 0);
        assert!(session.task_calls.is_empty());
    }

    // =========================================================================
    // get_task_calls
    // =========================================================================

    #[test]
    fn test_get_task_calls_extracts_tasks() {
        let mut msg = make_msg("a1", "assistant", false, false);
        msg.tool_calls = vec![
            ToolCall {
                id: "tc1".to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({}),
                is_task: false,
                task_description: None,
                task_subagent_type: None,
            },
            ToolCall {
                id: "tc2".to_string(),
                name: "Task".to_string(),
                input: serde_json::json!({"description": "search"}),
                is_task: true,
                task_description: Some("search".to_string()),
                task_subagent_type: None,
            },
        ];

        let session = process_messages(vec![msg], SessionFileMetadata::default());
        assert_eq!(session.task_calls.len(), 1);
        assert_eq!(session.task_calls[0].name, "Task");
    }

    // =========================================================================
    // parse_session_file (integration)
    // =========================================================================

    #[test]
    fn test_parse_session_file_full_flow() {
        let dir = test_dir("full_flow");
        let file_path = dir.join("session.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(
            file,
            r#"{{"type":"custom-title","customTitle":"Full Test"}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"hello"}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"assistant","uuid":"a1","parentUuid":"u1","isSidechain":false,"cwd":"/tmp","requestId":"req1","message":{{"role":"assistant","model":"claude-sonnet-4-20250514","content":[{{"type":"text","text":"Hi!"}}],"usage":{{"input_tokens":100,"output_tokens":50}}}}}}"#
        )
        .unwrap();

        let session = parse_session_file(&file_path).unwrap();
        assert_eq!(session.messages.len(), 2);
        assert_eq!(session.custom_title.as_deref(), Some("Full Test"));
        assert_eq!(session.by_type.user.len(), 1);
        assert_eq!(session.by_type.assistant.len(), 1);
        assert_eq!(session.metrics.input_tokens, 100);
        assert_eq!(session.metrics.output_tokens, 50);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_parse_session_file_nonexistent() {
        let session = parse_session_file(Path::new("/nonexistent/path.jsonl")).unwrap();
        assert!(session.messages.is_empty());
    }
}
