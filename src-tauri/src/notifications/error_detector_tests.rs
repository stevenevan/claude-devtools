//! Ported from `internal/notifications/notifications_test.go`
//! (`TestDetectErrorsEmptyTriggers` + a positive detector smoke test).
//! Synthetic in-memory messages only. Included by error_detector.rs via
//! `#[path] mod tests;`.

use super::*;
use crate::config::state::types::NotificationTrigger;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};
use serde_json::json;

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
fn detect_errors_empty_triggers() {
    let errors = detect_errors(&[], "s", "p", "/f", &[]);
    assert!(errors.is_empty());
}

#[test]
fn detect_errors_tool_use_trigger_fires_with_line_number() {
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

    let errors = detect_errors(
        std::slice::from_ref(&msg),
        "s",
        "p",
        "/f",
        std::slice::from_ref(&trigger),
    );
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].source, "Bash");
    assert_eq!(errors[0].line_number, Some(1));
}

#[test]
fn detect_errors_repository_scope_excludes_other_projects() {
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
    trigger.repository_ids = Some(vec!["other-project".to_string()]);

    let errors = detect_errors(
        std::slice::from_ref(&msg),
        "s",
        "p",
        "/f",
        std::slice::from_ref(&trigger),
    );
    assert!(errors.is_empty());
}
