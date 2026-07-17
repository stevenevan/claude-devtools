use super::*;
use crate::types::messages::ParsedMessageContent;

fn make_entry(json: &str) -> RawJsonlEntry {
    serde_json::from_str(json).unwrap()
}

// System entries

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

// Progress + queue-operation

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

// Skip/reject + metadata passthrough

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
    assert_eq!(msg.source_tool_assistant_uuid.as_deref(), Some("a_parent"));
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
    assert!(!msg.timestamp.is_empty());
}
