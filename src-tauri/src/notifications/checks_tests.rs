//! Ported/derived from `internal/notifications/notifications_test.go`
//! (check-function coverage). Synthetic in-memory messages only — no filesystem,
//! never real ~/.claude. Included by checks.rs via `#[path] mod tests;`.

use super::*;
use crate::config::state::types::NotificationTrigger;
use crate::notifications::tool_maps::ToolResultInfo;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};
use serde_json::json;
use std::collections::HashMap;

fn trigger_base() -> NotificationTrigger {
    NotificationTrigger {
        id: "trig1".to_string(),
        name: "Test".to_string(),
        enabled: true,
        content_type: String::new(),
        mode: String::new(),
        tool_name: None,
        is_builtin: None,
        ignore_patterns: None,
        require_error: None,
        match_field: None,
        match_pattern: None,
        token_threshold: None,
        token_type: None,
        repository_ids: None,
        color: None,
    }
}

fn assistant_with_blocks(blocks: Vec<ContentBlock>) -> ParsedMessage {
    ParsedMessage {
        uuid: "u1".to_string(),
        parent_uuid: None,
        message_type: "assistant".to_string(),
        timestamp: "2024-01-15T10:30:00Z".to_string(),
        role: Some("assistant".to_string()),
        content: ParsedMessageContent::Blocks(blocks),
        usage: None,
        model: None,
        cwd: Some("/Users/me/project".to_string()),
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
    }
}

#[test]
fn tool_use_trigger_matches_command_field() {
    let msg = assistant_with_blocks(vec![ContentBlock::ToolUse {
        id: "t1".to_string(),
        name: "Bash".to_string(),
        input: json!({"command": "rm -rf /tmp/x"}),
    }]);
    let mut trigger = trigger_base();
    trigger.content_type = "tool_use".to_string();
    trigger.tool_name = Some("Bash".to_string());
    trigger.match_field = Some("command".to_string());
    trigger.match_pattern = Some("rm -rf".to_string());

    let err = check_tool_use_trigger(&msg, &trigger, "s", "p", "/f", 1).expect("expected a match");
    assert_eq!(err.source, "Bash");
    assert_eq!(err.tool_use_id.as_deref(), Some("t1"));
    assert!(err.message.starts_with("command: rm -rf"));
}

#[test]
fn tool_use_trigger_no_match_when_pattern_absent() {
    let msg = assistant_with_blocks(vec![ContentBlock::ToolUse {
        id: "t1".to_string(),
        name: "Bash".to_string(),
        input: json!({"command": "ls -la"}),
    }]);
    let mut trigger = trigger_base();
    trigger.content_type = "tool_use".to_string();
    trigger.tool_name = Some("Bash".to_string());
    trigger.match_field = Some("command".to_string());
    trigger.match_pattern = Some("rm -rf".to_string());

    assert!(check_tool_use_trigger(&msg, &trigger, "s", "p", "/f", 1).is_none());
}

#[test]
fn tool_use_trigger_skips_non_assistant() {
    let mut msg = assistant_with_blocks(vec![ContentBlock::ToolUse {
        id: "t1".to_string(),
        name: "Bash".to_string(),
        input: json!({"command": "rm -rf /"}),
    }]);
    msg.message_type = "user".to_string();
    let mut trigger = trigger_base();
    trigger.content_type = "tool_use".to_string();

    assert!(check_tool_use_trigger(&msg, &trigger, "s", "p", "/f", 1).is_none());
}

#[test]
fn token_threshold_emits_when_over() {
    let msg = assistant_with_blocks(vec![ContentBlock::ToolUse {
        id: "t1".to_string(),
        name: "Bash".to_string(),
        input: json!({"command": "echo hello world this is a long command line"}),
    }]);
    let mut trigger = trigger_base();
    trigger.mode = "token_threshold".to_string();
    trigger.token_threshold = Some(1.0);
    trigger.token_type = Some("input".to_string());

    let empty: HashMap<String, ToolResultInfo> = HashMap::new();
    let errors = check_token_threshold_trigger(&msg, &trigger, &empty, "s", "p", "/f", 1);
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].source, "Bash");
}

#[test]
fn token_threshold_silent_when_under() {
    let msg = assistant_with_blocks(vec![ContentBlock::ToolUse {
        id: "t1".to_string(),
        name: "Bash".to_string(),
        input: json!({"command": "ls"}),
    }]);
    let mut trigger = trigger_base();
    trigger.mode = "token_threshold".to_string();
    trigger.token_threshold = Some(1_000_000.0);
    trigger.token_type = Some("input".to_string());

    let empty: HashMap<String, ToolResultInfo> = HashMap::new();
    let errors = check_token_threshold_trigger(&msg, &trigger, &empty, "s", "p", "/f", 1);
    assert!(errors.is_empty());
}

#[test]
fn truncate_bytes_backs_off_char_boundary() {
    assert_eq!(truncate_bytes("hello", 200), "hello");
    assert_eq!(truncate_bytes("abcdef", 3), "abc");
    // 'é' is 2 bytes; truncating mid-char must not panic and backs off.
    let s = "aé";
    assert_eq!(truncate_bytes(s, 2), "a");
}
