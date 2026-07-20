use super::*;
use crate::parsing::test_support::make_blocks_msg;
use crate::types::jsonl::{ContentBlock, ToolResultContentValue};
use serde_json::json;

#[test]
fn build_tool_use_map_indexes_assistant_blocks() {
    let mut msg = make_blocks_msg(
        vec![ContentBlock::ToolUse {
            id: "t1".to_string(),
            name: "Bash".to_string(),
            input: json!({"command": "ls"}),
        }],
        false,
    );
    msg.message_type = "assistant".to_string();

    let map = build_tool_use_map(std::slice::from_ref(&msg));
    assert_eq!(map.get("t1").map(|i| i.name.as_str()), Some("Bash"));
}

#[test]
fn build_tool_use_map_ignores_non_assistant() {
    let msg = make_blocks_msg(
        vec![ContentBlock::ToolUse {
            id: "t1".to_string(),
            name: "Bash".to_string(),
            input: json!({}),
        }],
        false,
    );

    let map = build_tool_use_map(std::slice::from_ref(&msg));
    assert!(map.is_empty());
}

#[test]
fn build_tool_result_map_indexes_text_blocks() {
    let msg = make_blocks_msg(
        vec![ContentBlock::ToolResult {
            tool_use_id: "t1".to_string(),
            content: ToolResultContentValue::Text("error output".to_string()),
            is_error: Some(true),
        }],
        false,
    );

    let map = build_tool_result_map(std::slice::from_ref(&msg));
    assert_eq!(map.get("t1").map(|i| i.content.as_str()), Some("error output"));
}

#[test]
fn build_tool_result_map_first_write_wins() {
    let first = make_blocks_msg(
        vec![ContentBlock::ToolResult {
            tool_use_id: "t1".to_string(),
            content: ToolResultContentValue::Text("first".to_string()),
            is_error: None,
        }],
        false,
    );
    let second = make_blocks_msg(
        vec![ContentBlock::ToolResult {
            tool_use_id: "t1".to_string(),
            content: ToolResultContentValue::Text("second".to_string()),
            is_error: None,
        }],
        false,
    );

    let map = build_tool_result_map(&[first, second]);
    assert_eq!(map.get("t1").map(|i| i.content.as_str()), Some("first"));
}
