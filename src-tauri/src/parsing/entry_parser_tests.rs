use super::*;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::ParsedMessageContent;

fn make_entry(json: &str) -> RawJsonlEntry {
    serde_json::from_str(json).unwrap()
}

// User entries

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

// Assistant entries

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
    assert_eq!(msg.tool_calls[0].task_description.as_deref(), Some("search code"));
    assert_eq!(msg.tool_calls[0].task_subagent_type.as_deref(), Some("Explore"));
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

