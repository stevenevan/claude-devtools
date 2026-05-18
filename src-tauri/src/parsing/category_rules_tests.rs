use super::*;
use super::super::content_type::*;
use super::super::test_support::{make_blocks_msg, make_user_msg};
use crate::types::jsonl::ContentBlock;

#[test]
fn test_user_chunk_categorized_as_user() {
    let msg = make_user_msg("help me debug this", false);
    assert_eq!(categorize_message(&msg), MessageCategory::User);
}

#[test]
fn test_system_chunk_categorized_as_system() {
    let msg = make_user_msg("<local-command-stdout>output</local-command-stdout>", false);
    assert_eq!(categorize_message(&msg), MessageCategory::System);
}

#[test]
fn test_event_api_error_categorized_as_event() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    msg.subtype = Some("api_error".to_string());
    assert_eq!(categorize_message(&msg), MessageCategory::Event);
}

#[test]
fn test_hard_noise_caveat_categorized_as_noise() {
    let msg = make_user_msg("<local-command-caveat>caveat text</local-command-caveat>", false);
    assert_eq!(categorize_message(&msg), MessageCategory::HardNoise);
}

#[test]
fn test_compact_summary_categorized_as_compact() {
    let mut msg = make_user_msg("", false);
    msg.is_compact_summary = Some(true);
    assert_eq!(categorize_message(&msg), MessageCategory::Compact);
}

#[test]
fn test_assistant_categorized_as_ai() {
    let mut msg = make_user_msg("response", false);
    msg.message_type = "assistant".to_string();
    msg.role = Some("assistant".to_string());
    assert_eq!(categorize_message(&msg), MessageCategory::Ai);
}

// Priority ordering checks

#[test]
fn test_categorize_event_priority_over_noise() {
    // system type with displayable subtype → Event, not HardNoise
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    msg.subtype = Some("api_error".to_string());
    assert_eq!(categorize_message(&msg), MessageCategory::Event);
}

#[test]
fn test_categorize_compact_priority_over_user() {
    // compact summary on a user message → Compact, not User
    let mut msg = make_user_msg("content", false);
    msg.is_compact_summary = Some(true);
    assert_eq!(categorize_message(&msg), MessageCategory::Compact);
}

#[test]
fn test_categorize_system_priority_over_user() {
    // stdout content on user message → System, not User
    let msg = make_user_msg("<local-command-stdout>output</local-command-stdout>", false);
    assert_eq!(categorize_message(&msg), MessageCategory::System);
}

#[test]
fn test_categorize_hard_noise_system_no_subtype() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    // No subtype → HardNoise
    assert_eq!(categorize_message(&msg), MessageCategory::HardNoise);
}

#[test]
fn test_categorize_meta_user_as_ai() {
    // Meta user message (tool result) — not user/system/noise → Ai fallback
    let msg = make_user_msg("tool output", true);
    assert_eq!(categorize_message(&msg), MessageCategory::Ai);
}

#[test]
fn test_categorize_empty_falls_through_to_ai() {
    let msg = make_user_msg("", false);
    assert_eq!(categorize_message(&msg), MessageCategory::Ai);
}

#[test]
fn test_categorize_assistant_role_is_ai() {
    let mut msg = make_user_msg("hello", false);
    msg.message_type = "assistant".to_string();
    msg.role = Some("assistant".to_string());
    assert_eq!(categorize_message(&msg), MessageCategory::Ai);
}

#[test]
fn test_categorize_meta_with_tool_use_block_is_ai() {
    let msg = make_blocks_msg(
        vec![ContentBlock::ToolUse {
            id: "tu1".to_string(),
            name: "Read".to_string(),
            input: serde_json::json!({}),
        }],
        true,
    );
    assert_eq!(categorize_message(&msg), MessageCategory::Ai);
}
