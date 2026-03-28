/// Parse a raw JSONL entry into a ParsedMessage.

use serde_json::Value;

use crate::types::jsonl::{ContentBlock, RawJsonlEntry};
use crate::types::messages::{ParsedMessage, ParsedMessageContent, SystemEventData, TokenUsage};

use super::tool_extraction::{extract_tool_calls, extract_tool_results};

/// Known message types.
const KNOWN_TYPES: &[&str] = &[
    "user",
    "assistant",
    "system",
    "summary",
    "file-history-snapshot",
    "queue-operation",
    "progress",
];

/// Parse a single raw JSONL entry into a ParsedMessage.
/// Returns None for entries without uuid or unknown types.
pub fn parse_entry(entry: &RawJsonlEntry) -> Option<ParsedMessage> {
    if !KNOWN_TYPES.contains(&entry.entry_type.as_str()) {
        return None;
    }

    // Get uuid, or generate a synthetic one for progress entries
    let uuid = match entry.uuid.as_ref() {
        Some(u) if !u.is_empty() => u.clone(),
        _ => {
            if entry.entry_type == "progress" {
                // Generate synthetic uuid from toolUseID + timestamp
                let tool_id = entry.tool_use_id_ref.as_deref().unwrap_or("unknown");
                let ts = entry.timestamp.as_deref().unwrap_or("0");
                format!("progress-{}-{}", tool_id, ts)
            } else {
                return None;
            }
        }
    };

    let is_conversational = matches!(
        entry.entry_type.as_str(),
        "user" | "assistant" | "system"
    );

    let mut content = ParsedMessageContent::Text(String::new());
    let mut role = None;
    let mut usage = None;
    let mut model = None;
    let mut request_id = None;
    let mut is_meta = entry.is_meta.unwrap_or(false);
    let mut is_compact_summary = entry.is_compact_summary.unwrap_or(false);
    let mut subtype: Option<String> = None;
    let mut event_data: Option<SystemEventData> = None;

    if is_conversational {
        if let Some(ref msg_value) = entry.message {
            match entry.entry_type.as_str() {
                "user" => {
                    // Extract user message content
                    if let Some(msg_content) = msg_value.get("content") {
                        content = parse_message_content(msg_content);
                    }
                    role = msg_value
                        .get("role")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                "assistant" => {
                    // Extract assistant message content (always array)
                    if let Some(msg_content) = msg_value.get("content") {
                        content = parse_message_content(msg_content);
                    }
                    role = msg_value
                        .get("role")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    model = msg_value
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    // Extract usage
                    if let Some(usage_val) = msg_value.get("usage") {
                        usage = Some(TokenUsage {
                            input_tokens: usage_val
                                .get("input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            output_tokens: usage_val
                                .get("output_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            cache_read_input_tokens: usage_val
                                .get("cache_read_input_tokens")
                                .and_then(|v| v.as_u64()),
                            cache_creation_input_tokens: usage_val
                                .get("cache_creation_input_tokens")
                                .and_then(|v| v.as_u64()),
                        });
                    }

                    request_id = entry.request_id.clone();
                }
                "system" => {
                    is_meta = entry.is_meta.unwrap_or(false);
                    if let Some(ref sub) = entry.subtype {
                        subtype = Some(sub.clone());
                        event_data = build_system_event_data(entry);
                    }
                }
                _ => {}
            }
        }

        // Check for isCompactSummary on user entries
        if entry.entry_type == "user" {
            if let Some(true) = entry.is_compact_summary {
                is_compact_summary = true;
            }
        }
    }

    // Handle non-conversational types
    if entry.entry_type == "progress" {
        subtype = Some("progress".to_string());
        // Extract progress message from data.message
        if let Some(ref data) = entry.data {
            if let Some(msg) = data.get("message").and_then(|v| v.as_str()) {
                content = ParsedMessageContent::Text(msg.to_string());
            }
        }
    }

    if entry.entry_type == "queue-operation" {
        subtype = Some("queue_operation".to_string());
        event_data = Some(SystemEventData {
            subtype: "queue_operation".to_string(),
            operation: entry.operation.clone(),
            queued_content: entry.content.clone(),
            ..Default::default()
        });
    }

    let tool_calls = extract_tool_calls(&content);
    let tool_results = extract_tool_results(&content);

    let timestamp = entry
        .timestamp
        .clone()
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    Some(ParsedMessage {
        uuid: uuid.clone(),
        parent_uuid: if is_conversational {
            entry.parent_uuid.clone()
        } else {
            None
        },
        message_type: entry.entry_type.clone(),
        timestamp,
        role,
        content,
        usage,
        model,
        cwd: entry.cwd.clone(),
        git_branch: entry.git_branch.clone(),
        agent_id: entry.agent_id.clone(),
        is_sidechain: entry.is_sidechain,
        is_meta,
        user_type: entry.user_type.clone(),
        tool_calls,
        tool_results,
        source_tool_use_id: entry.source_tool_use_id.clone(),
        source_tool_assistant_uuid: entry.source_tool_assistant_uuid.clone(),
        tool_use_result: entry.tool_use_result.clone(),
        is_compact_summary: if is_compact_summary { Some(true) } else { None },
        request_id,
        subtype,
        event_data,
    })
}

/// Build SystemEventData from a RawJsonlEntry for displayable system subtypes.
fn build_system_event_data(entry: &RawJsonlEntry) -> Option<SystemEventData> {
    let subtype = entry.subtype.as_deref()?;
    match subtype {
        "api_error" => {
            let mut error_status: Option<u16> = None;
            let mut error_type: Option<String> = None;
            let mut error_message: Option<String> = None;

            if let Some(ref err) = entry.error {
                error_status = err
                    .get("status")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u16);
                // Try nested error.error.type / error.error.message
                if let Some(inner) = err.get("error") {
                    error_type = inner
                        .get("type")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    error_message = inner
                        .get("message")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
            // Fallback: try cause for connection errors
            if error_type.is_none() {
                if let Some(ref cause) = entry.cause {
                    error_type = cause
                        .get("code")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }

            Some(SystemEventData {
                subtype: subtype.to_string(),
                error_status,
                error_type,
                error_message,
                retry_attempt: entry.retry_attempt,
                max_retries: entry.max_retries,
                retry_in_ms: entry.retry_in_ms,
                ..Default::default()
            })
        }
        "bridge_status" => Some(SystemEventData {
            subtype: subtype.to_string(),
            bridge_content: entry.content.clone(),
            bridge_url: entry.url.clone(),
            ..Default::default()
        }),
        "memory_saved" => Some(SystemEventData {
            subtype: subtype.to_string(),
            written_paths: entry.written_paths.clone(),
            memory_verb: entry.verb.clone(),
            ..Default::default()
        }),
        "turn_duration" => Some(SystemEventData {
            subtype: subtype.to_string(),
            duration_ms: entry.duration_ms,
            ..Default::default()
        }),
        _ => None,
    }
}

/// Parse message content from a JSON value into ParsedMessageContent.
fn parse_message_content(value: &Value) -> ParsedMessageContent {
    match value {
        Value::String(s) => ParsedMessageContent::Text(s.clone()),
        Value::Array(arr) => {
            // Try to deserialize as Vec<ContentBlock>
            let blocks: Vec<ContentBlock> = arr
                .iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect();
            ParsedMessageContent::Blocks(blocks)
        }
        _ => ParsedMessageContent::Text(String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(json: &str) -> RawJsonlEntry {
        serde_json::from_str(json).unwrap()
    }

    // =========================================================================
    // User entries
    // =========================================================================

    #[test]
    fn test_parse_user_entry() {
        let entry = make_entry(
            r#"{
                "type": "user",
                "uuid": "u1",
                "parentUuid": null,
                "isSidechain": false,
                "userType": "external",
                "cwd": "/tmp",
                "sessionId": "s1",
                "version": "1",
                "gitBranch": "main",
                "message": {"role": "user", "content": "hello world"},
                "isMeta": false
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.uuid, "u1");
        assert_eq!(msg.message_type, "user");
        assert!(!msg.is_meta);
        assert!(!msg.is_sidechain);
        assert_eq!(msg.cwd.as_deref(), Some("/tmp"));
        assert_eq!(msg.git_branch.as_deref(), Some("main"));
        match msg.content {
            ParsedMessageContent::Text(ref t) => assert_eq!(t, "hello world"),
            _ => panic!("expected text content"),
        }
    }

    #[test]
    fn test_parse_user_entry_meta() {
        let entry = make_entry(
            r#"{
                "type": "user",
                "uuid": "u2",
                "parentUuid": "a1",
                "isSidechain": false,
                "isMeta": true,
                "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu1", "content": "result text"}]}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert!(msg.is_meta);
        assert_eq!(msg.parent_uuid.as_deref(), Some("a1"));
    }

    #[test]
    fn test_parse_user_entry_sidechain() {
        let entry = make_entry(
            r#"{
                "type": "user",
                "uuid": "u3",
                "isSidechain": true,
                "message": {"role": "user", "content": "subagent input"}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert!(msg.is_sidechain);
    }

    #[test]
    fn test_parse_user_entry_compact_summary() {
        let entry = make_entry(
            r#"{
                "type": "user",
                "uuid": "u4",
                "isSidechain": false,
                "isCompactSummary": true,
                "message": {"role": "user", "content": "compacted conversation summary"}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.is_compact_summary, Some(true));
    }

    #[test]
    fn test_parse_user_entry_with_content_blocks() {
        let entry = make_entry(
            r#"{
                "type": "user",
                "uuid": "u5",
                "isSidechain": false,
                "message": {"role": "user", "content": [{"type": "text", "text": "block text"}]}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        match &msg.content {
            ParsedMessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 1);
                if let ContentBlock::Text { text } = &blocks[0] {
                    assert_eq!(text, "block text");
                } else {
                    panic!("expected text block");
                }
            }
            _ => panic!("expected blocks content"),
        }
    }

    // =========================================================================
    // Assistant entries
    // =========================================================================

    #[test]
    fn test_parse_assistant_entry_with_usage() {
        let entry = make_entry(
            r#"{
                "type": "assistant",
                "uuid": "a1",
                "parentUuid": "u1",
                "isSidechain": false,
                "userType": "external",
                "cwd": "/tmp",
                "sessionId": "s1",
                "version": "1",
                "gitBranch": "main",
                "requestId": "req1",
                "message": {
                    "role": "assistant",
                    "model": "claude-sonnet-4-20250514",
                    "id": "msg1",
                    "type": "message",
                    "content": [{"type": "text", "text": "Hello!"}],
                    "stop_reason": "end_turn",
                    "stop_sequence": null,
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "cache_read_input_tokens": 10
                    }
                }
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.message_type, "assistant");
        assert_eq!(msg.model.as_deref(), Some("claude-sonnet-4-20250514"));
        assert_eq!(msg.request_id.as_deref(), Some("req1"));
        let usage = msg.usage.unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_input_tokens, Some(10));
    }

    #[test]
    fn test_parse_assistant_entry_with_cache_creation() {
        let entry = make_entry(
            r#"{
                "type": "assistant",
                "uuid": "a2",
                "isSidechain": false,
                "message": {
                    "role": "assistant",
                    "model": "claude-opus-4-20250514",
                    "content": [{"type": "text", "text": "response"}],
                    "usage": {
                        "input_tokens": 200,
                        "output_tokens": 100,
                        "cache_creation_input_tokens": 50
                    }
                }
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        let usage = msg.usage.unwrap();
        assert_eq!(usage.cache_creation_input_tokens, Some(50));
        assert_eq!(usage.cache_read_input_tokens, None);
    }

    #[test]
    fn test_parse_assistant_entry_with_tool_use() {
        let entry = make_entry(
            r#"{
                "type": "assistant",
                "uuid": "a3",
                "isSidechain": false,
                "message": {
                    "role": "assistant",
                    "model": "claude-sonnet-4-20250514",
                    "content": [
                        {"type": "thinking", "thinking": "Let me read that file", "signature": "sig1"},
                        {"type": "tool_use", "id": "tu1", "name": "Read", "input": {"file_path": "/tmp/test.txt"}}
                    ],
                    "usage": {"input_tokens": 50, "output_tokens": 30}
                }
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.tool_calls.len(), 1);
        assert_eq!(msg.tool_calls[0].name, "Read");
        assert_eq!(msg.tool_calls[0].id, "tu1");
        assert!(!msg.tool_calls[0].is_task);
    }

    #[test]
    fn test_parse_assistant_entry_with_task_tool() {
        let entry = make_entry(
            r#"{
                "type": "assistant",
                "uuid": "a4",
                "isSidechain": false,
                "message": {
                    "role": "assistant",
                    "model": "claude-sonnet-4-20250514",
                    "content": [
                        {"type": "tool_use", "id": "tu2", "name": "Task", "input": {"description": "search code", "subagent_type": "Explore"}}
                    ],
                    "usage": {"input_tokens": 40, "output_tokens": 20}
                }
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.tool_calls.len(), 1);
        assert!(msg.tool_calls[0].is_task);
        assert_eq!(
            msg.tool_calls[0].task_description.as_deref(),
            Some("search code")
        );
        assert_eq!(
            msg.tool_calls[0].task_subagent_type.as_deref(),
            Some("Explore")
        );
    }

    #[test]
    fn test_parse_assistant_entry_no_usage() {
        let entry = make_entry(
            r#"{
                "type": "assistant",
                "uuid": "a5",
                "isSidechain": false,
                "message": {
                    "role": "assistant",
                    "model": "claude-sonnet-4-20250514",
                    "content": [{"type": "text", "text": "partial"}]
                }
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert!(msg.usage.is_none());
    }

    // =========================================================================
    // System entries
    // =========================================================================

    #[test]
    fn test_parse_system_api_error() {
        let entry = make_entry(
            r#"{
                "type": "system",
                "uuid": "s1",
                "isSidechain": false,
                "subtype": "api_error",
                "message": {},
                "error": {
                    "status": 529,
                    "error": {
                        "type": "overloaded_error",
                        "message": "API is overloaded"
                    }
                },
                "retryAttempt": 1,
                "maxRetries": 3,
                "retryInMs": 5000.0
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.subtype.as_deref(), Some("api_error"));
        let event = msg.event_data.unwrap();
        assert_eq!(event.error_status, Some(529));
        assert_eq!(event.error_type.as_deref(), Some("overloaded_error"));
        assert_eq!(event.error_message.as_deref(), Some("API is overloaded"));
        assert_eq!(event.retry_attempt, Some(1));
        assert_eq!(event.max_retries, Some(3));
    }

    #[test]
    fn test_parse_system_bridge_status() {
        let entry = make_entry(
            r#"{
                "type": "system",
                "uuid": "s2",
                "isSidechain": false,
                "subtype": "bridge_status",
                "message": {},
                "content": "Connected",
                "url": "https://bridge.example.com"
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        let event = msg.event_data.unwrap();
        assert_eq!(event.subtype, "bridge_status");
        assert_eq!(event.bridge_content.as_deref(), Some("Connected"));
        assert_eq!(event.bridge_url.as_deref(), Some("https://bridge.example.com"));
    }

    #[test]
    fn test_parse_system_memory_saved() {
        let entry = make_entry(
            r#"{
                "type": "system",
                "uuid": "s3",
                "isSidechain": false,
                "subtype": "memory_saved",
                "message": {},
                "writtenPaths": ["/home/user/.claude/memory/test.md"],
                "verb": "created"
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        let event = msg.event_data.unwrap();
        assert_eq!(event.subtype, "memory_saved");
        assert_eq!(event.memory_verb.as_deref(), Some("created"));
        assert_eq!(event.written_paths.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn test_parse_system_turn_duration() {
        let entry = make_entry(
            r#"{
                "type": "system",
                "uuid": "s4",
                "isSidechain": false,
                "subtype": "turn_duration",
                "message": {},
                "durationMs": 12345.0
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        let event = msg.event_data.unwrap();
        assert_eq!(event.duration_ms, Some(12345.0));
    }

    #[test]
    fn test_parse_system_without_uuid_skipped() {
        let entry = make_entry(r#"{"type": "system", "subtype": "init"}"#);
        assert!(parse_entry(&entry).is_none());
    }

    // =========================================================================
    // Progress entries
    // =========================================================================

    #[test]
    fn test_parse_progress_entry_generates_uuid() {
        let entry = make_entry(
            r#"{
                "type": "progress",
                "toolUseID": "tu_abc",
                "timestamp": "2024-01-01T00:00:00Z",
                "data": {"message": "Processing file 3/10"}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.message_type, "progress");
        assert!(msg.uuid.starts_with("progress-"));
        assert_eq!(msg.subtype.as_deref(), Some("progress"));
        match msg.content {
            ParsedMessageContent::Text(ref t) => assert_eq!(t, "Processing file 3/10"),
            _ => panic!("expected text content"),
        }
    }

    #[test]
    fn test_parse_progress_entry_without_tool_id() {
        let entry = make_entry(
            r#"{
                "type": "progress",
                "timestamp": "2024-01-01T00:00:00Z",
                "data": {"message": "Working..."}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert!(msg.uuid.starts_with("progress-unknown-"));
    }

    // =========================================================================
    // Queue-operation entries
    // =========================================================================

    #[test]
    fn test_parse_queue_operation() {
        let entry = make_entry(
            r#"{
                "type": "queue-operation",
                "uuid": "q1",
                "isSidechain": false,
                "operation": "enqueue",
                "content": "queued message content"
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.message_type, "queue-operation");
        assert_eq!(msg.subtype.as_deref(), Some("queue_operation"));
        let event = msg.event_data.unwrap();
        assert_eq!(event.operation.as_deref(), Some("enqueue"));
        assert_eq!(event.queued_content.as_deref(), Some("queued message content"));
    }

    // =========================================================================
    // Skip/reject cases
    // =========================================================================

    #[test]
    fn test_skip_unknown_type() {
        let entry = make_entry(r#"{"type": "unknown_thing", "uuid": "x1"}"#);
        assert!(parse_entry(&entry).is_none());
    }

    #[test]
    fn test_skip_entry_with_empty_uuid() {
        let entry = make_entry(
            r#"{"type": "user", "uuid": "", "isSidechain": false, "message": {"role": "user", "content": "hi"}}"#,
        );
        assert!(parse_entry(&entry).is_none());
    }

    // =========================================================================
    // parse_message_content
    // =========================================================================

    #[test]
    fn test_parse_content_string() {
        let val = serde_json::json!("simple text");
        let content = parse_message_content(&val);
        match content {
            ParsedMessageContent::Text(t) => assert_eq!(t, "simple text"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn test_parse_content_array_of_blocks() {
        let val = serde_json::json!([
            {"type": "text", "text": "block 1"},
            {"type": "text", "text": "block 2"}
        ]);
        let content = parse_message_content(&val);
        match content {
            ParsedMessageContent::Blocks(blocks) => assert_eq!(blocks.len(), 2),
            _ => panic!("expected blocks"),
        }
    }

    #[test]
    fn test_parse_content_number_falls_back_to_empty() {
        let val = serde_json::json!(42);
        let content = parse_message_content(&val);
        match content {
            ParsedMessageContent::Text(t) => assert!(t.is_empty()),
            _ => panic!("expected empty text fallback"),
        }
    }

    #[test]
    fn test_parse_content_array_skips_unrecognized_blocks() {
        let val = serde_json::json!([
            {"type": "text", "text": "valid"},
            {"type": "totally_unknown", "data": 123}
        ]);
        let content = parse_message_content(&val);
        match content {
            ParsedMessageContent::Blocks(blocks) => {
                // Only the valid text block is parsed
                assert_eq!(blocks.len(), 1);
            }
            _ => panic!("expected blocks"),
        }
    }

    // =========================================================================
    // Metadata passthrough
    // =========================================================================

    #[test]
    fn test_agent_id_passthrough() {
        let entry = make_entry(
            r#"{
                "type": "user",
                "uuid": "u10",
                "isSidechain": true,
                "agentId": "agent-abc",
                "message": {"role": "user", "content": "subagent input"}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.agent_id.as_deref(), Some("agent-abc"));
    }

    #[test]
    fn test_source_tool_fields_passthrough() {
        let entry = make_entry(
            r#"{
                "type": "user",
                "uuid": "u11",
                "isSidechain": true,
                "sourceToolUseId": "tu_parent",
                "sourceToolAssistantUUID": "a_parent",
                "message": {"role": "user", "content": "tool result"}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        assert_eq!(msg.source_tool_use_id.as_deref(), Some("tu_parent"));
        assert_eq!(
            msg.source_tool_assistant_uuid.as_deref(),
            Some("a_parent")
        );
    }

    #[test]
    fn test_timestamp_fallback_to_now() {
        let entry = make_entry(
            r#"{
                "type": "user",
                "uuid": "u12",
                "isSidechain": false,
                "message": {"role": "user", "content": "no timestamp"}
            }"#,
        );

        let msg = parse_entry(&entry).unwrap();
        // Should have a timestamp (auto-generated)
        assert!(!msg.timestamp.is_empty());
    }
}
