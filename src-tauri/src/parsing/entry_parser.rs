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
];

/// Parse a single raw JSONL entry into a ParsedMessage.
/// Returns None for entries without uuid or unknown types.
pub fn parse_entry(entry: &RawJsonlEntry) -> Option<ParsedMessage> {
    let uuid = entry.uuid.as_ref()?;
    if uuid.is_empty() {
        return None;
    }

    if !KNOWN_TYPES.contains(&entry.entry_type.as_str()) {
        return None;
    }

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
        match msg.content {
            ParsedMessageContent::Text(ref t) => assert_eq!(t, "hello world"),
            _ => panic!("expected text content"),
        }
    }

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
    fn test_skip_entry_without_uuid() {
        let entry = make_entry(r#"{"type": "system", "subtype": "init"}"#);
        assert!(parse_entry(&entry).is_none());
    }

    #[test]
    fn test_skip_unknown_type() {
        let entry = make_entry(r#"{"type": "unknown_thing", "uuid": "x1"}"#);
        assert!(parse_entry(&entry).is_none());
    }
}
