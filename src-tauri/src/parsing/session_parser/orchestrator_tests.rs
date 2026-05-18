use super::*;
use crate::types::messages::ParsedMessageContent;
use std::io::Write;
use std::path::Path;

fn test_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("claude-devtools-test")
        .join(name);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

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

// process_messages

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

// get_task_calls

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

// parse_session_file (integration)

#[test]
fn test_parse_session_file_full_flow() {
    let dir = test_dir("full_flow");
    let file_path = dir.join("session.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(file, r#"{{"type":"custom-title","customTitle":"Full Test"}}"#).unwrap();
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
