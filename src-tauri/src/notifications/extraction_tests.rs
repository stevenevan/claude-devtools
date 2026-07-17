use super::*;
use crate::parsing::test_support::make_blocks_msg;
use crate::types::jsonl::{ContentBlock, ToolResultContentValue};
use serde_json::json;

#[test]
fn get_tool_summary_read_returns_last_path_segment() {
    let input = json!({"file_path": "/Users/me/project/src/main.rs"});
    assert_eq!(get_tool_summary("Read", &input), "main.rs");
}

#[test]
fn get_tool_summary_bash_returns_command() {
    let input = json!({"command": "ls -la"});
    assert_eq!(get_tool_summary("Bash", &input), "ls -la");
}

#[test]
fn get_tool_summary_bash_truncates_long_command() {
    let cmd = "a".repeat(80);
    let input = json!({ "command": cmd });
    let summary = get_tool_summary("Bash", &input);
    assert_eq!(summary.len(), 63); // 60 chars + "..."
    assert!(summary.ends_with("..."));
}

#[test]
fn get_tool_summary_grep_returns_pattern_or_name() {
    assert_eq!(get_tool_summary("Grep", &json!({"pattern": "TODO"})), "TODO");
    assert_eq!(get_tool_summary("Grep", &json!({})), "Grep");
    assert_eq!(get_tool_summary("Unknown", &json!({})), "Unknown");
}

#[test]
fn extract_tool_results_reads_content_blocks() {
    let msg = make_blocks_msg(
        vec![ContentBlock::ToolResult {
            tool_use_id: "t1".to_string(),
            content: ToolResultContentValue::Text("boom".to_string()),
            is_error: Some(true),
        }],
        false,
    );

    let results = extract_tool_results(&msg);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].tool_use_id, "t1");
    assert!(results[0].is_error);
    assert_eq!(results[0].content, "boom");
}

#[test]
fn find_tool_name_by_id_matches_tool_calls() {
    let mut msg = make_blocks_msg(vec![], false);
    msg.tool_calls.push(crate::types::messages::ToolCall {
        id: "t1".to_string(),
        name: "Bash".to_string(),
        input: json!({}),
        is_task: false,
        task_description: None,
        task_subagent_type: None,
    });

    assert_eq!(find_tool_name_by_id(&msg, "t1"), Some("Bash".to_string()));
    assert_eq!(find_tool_name_by_id(&msg, "missing"), None);
}
