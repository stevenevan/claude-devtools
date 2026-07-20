use super::*;
use super::super::test_support::{make_blocks_msg, make_user_msg};

// is_parsed_real_user_message

#[test]
fn test_real_user_message() {
    let msg = make_user_msg("hello world", false);
    assert!(is_parsed_real_user_message(&msg));
}

#[test]
fn test_meta_message_not_real_user() {
    let msg = make_user_msg("tool result", true);
    assert!(!is_parsed_real_user_message(&msg));
}

#[test]
fn test_real_user_message_with_blocks() {
    let msg = make_blocks_msg(
        vec![ContentBlock::Text { text: "hello".to_string() }],
        false,
    );
    assert!(is_parsed_real_user_message(&msg));
}

#[test]
fn test_real_user_message_blocks_no_text_or_image() {
    let msg = make_blocks_msg(
        vec![ContentBlock::ToolUse {
            id: "tu1".to_string(),
            name: "Read".to_string(),
            input: serde_json::json!({}),
        }],
        false,
    );
    assert!(!is_parsed_real_user_message(&msg));
}

#[test]
fn test_real_user_message_assistant_type_rejected() {
    let mut msg = make_user_msg("text", false);
    msg.message_type = "assistant".to_string();
    assert!(!is_parsed_real_user_message(&msg));
}

// is_parsed_user_chunk_message

#[test]
fn test_user_chunk_message() {
    let msg = make_user_msg("help me debug this", false);
    assert!(is_parsed_user_chunk_message(&msg));
}

#[test]
fn test_user_chunk_excludes_meta() {
    let msg = make_user_msg("tool result content", true);
    assert!(!is_parsed_user_chunk_message(&msg));
}

#[test]
fn test_user_chunk_excludes_system_output_tags() {
    for tag in SYSTEM_OUTPUT_TAGS {
        let content = format!("{tag}content</{}>", &tag[1..]);
        let msg = make_user_msg(&content, false);
        assert!(!is_parsed_user_chunk_message(&msg), "Should exclude tag: {tag}");
    }
}

#[test]
fn test_user_chunk_excludes_empty_content() {
    let msg = make_user_msg("", false);
    assert!(!is_parsed_user_chunk_message(&msg));
}

#[test]
fn test_user_chunk_excludes_whitespace_only() {
    let msg = make_user_msg("   \t\n  ", false);
    assert!(!is_parsed_user_chunk_message(&msg));
}

#[test]
fn test_user_chunk_excludes_interruption_block() {
    let msg = make_blocks_msg(
        vec![ContentBlock::Text {
            text: "[Request interrupted by user at 2024-01-01]".to_string(),
        }],
        false,
    );
    assert!(!is_parsed_user_chunk_message(&msg));
}

#[test]
fn test_user_chunk_excludes_system_tag_in_blocks() {
    let msg = make_blocks_msg(
        vec![ContentBlock::Text {
            text: "<local-command-stdout>output</local-command-stdout>".to_string(),
        }],
        false,
    );
    assert!(!is_parsed_user_chunk_message(&msg));
}

#[test]
fn test_user_chunk_with_blocks_containing_text() {
    let msg = make_blocks_msg(
        vec![ContentBlock::Text { text: "Please fix this bug".to_string() }],
        false,
    );
    assert!(is_parsed_user_chunk_message(&msg));
}

// is_parsed_system_chunk_message

#[test]
fn test_system_chunk_stdout() {
    let msg = make_user_msg("<local-command-stdout>output</local-command-stdout>", false);
    assert!(is_parsed_system_chunk_message(&msg));
    assert!(!is_parsed_user_chunk_message(&msg));
}

#[test]
fn test_system_chunk_stderr() {
    let msg = make_user_msg("<local-command-stderr>error output</local-command-stderr>", false);
    assert!(is_parsed_system_chunk_message(&msg));
}

#[test]
fn test_system_chunk_from_blocks() {
    let msg = make_blocks_msg(
        vec![ContentBlock::Text {
            text: "<local-command-stdout>block output</local-command-stdout>".to_string(),
        }],
        false,
    );
    assert!(is_parsed_system_chunk_message(&msg));
}

#[test]
fn test_system_chunk_requires_user_type() {
    let mut msg = make_user_msg("<local-command-stdout>output</local-command-stdout>", false);
    msg.message_type = "assistant".to_string();
    assert!(!is_parsed_system_chunk_message(&msg));
}

// is_parsed_event_message

#[test]
fn test_event_api_error() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    msg.subtype = Some("api_error".to_string());
    assert!(is_parsed_event_message(&msg));
}

#[test]
fn test_event_bridge_status() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    msg.subtype = Some("bridge_status".to_string());
    assert!(is_parsed_event_message(&msg));
}

#[test]
fn test_event_memory_saved() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    msg.subtype = Some("memory_saved".to_string());
    assert!(is_parsed_event_message(&msg));
}

#[test]
fn test_event_turn_duration() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    msg.subtype = Some("turn_duration".to_string());
    assert!(is_parsed_event_message(&msg));
}

#[test]
fn test_event_queue_operation() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "queue-operation".to_string();
    assert!(is_parsed_event_message(&msg));
}

#[test]
fn test_event_system_without_displayable_subtype_is_not_event() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    msg.subtype = Some("init".to_string());
    assert!(!is_parsed_event_message(&msg));
}

#[test]
fn test_event_user_type_not_event() {
    let msg = make_user_msg("hello", false);
    assert!(!is_parsed_event_message(&msg));
}

// is_parsed_hard_noise_message

#[test]
fn test_hard_noise_caveat() {
    let msg = make_user_msg("<local-command-caveat>caveat text</local-command-caveat>", false);
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_system_reminder() {
    let msg = make_user_msg("<system-reminder>reminder text</system-reminder>", false);
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_empty_stdout() {
    let msg = make_user_msg("<local-command-stdout></local-command-stdout>", false);
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_empty_stderr() {
    let msg = make_user_msg("<local-command-stderr></local-command-stderr>", false);
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_interruption() {
    let msg = make_user_msg("[Request interrupted by user]", false);
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_interruption_with_details() {
    let msg = make_user_msg("[Request interrupted by user at 2024-01-01T12:00:00Z]", false);
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_system_type() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_system_with_displayable_subtype_not_noise() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "system".to_string();
    msg.subtype = Some("api_error".to_string());
    assert!(!is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_synthetic_assistant() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "assistant".to_string();
    msg.model = Some("<synthetic>".to_string());
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_real_assistant_not_noise() {
    let mut msg = make_user_msg("response", false);
    msg.message_type = "assistant".to_string();
    msg.model = Some("claude-sonnet-4-20250514".to_string());
    assert!(!is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_summary_type() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "summary".to_string();
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_file_history_snapshot() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "file-history-snapshot".to_string();
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_progress() {
    let mut msg = make_user_msg("", false);
    msg.message_type = "progress".to_string();
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_hard_noise_interruption_in_blocks() {
    let msg = make_blocks_msg(
        vec![ContentBlock::Text { text: "[Request interrupted by user]".to_string() }],
        false,
    );
    assert!(is_parsed_hard_noise_message(&msg));
}

#[test]
fn test_regular_user_message_not_hard_noise() {
    let msg = make_user_msg("please fix the bug", false);
    assert!(!is_parsed_hard_noise_message(&msg));
}

// is_parsed_compact_message

#[test]
fn test_compact_message() {
    let mut msg = make_user_msg("", false);
    msg.is_compact_summary = Some(true);
    assert!(is_parsed_compact_message(&msg));
}

#[test]
fn test_compact_false_not_compact() {
    let mut msg = make_user_msg("", false);
    msg.is_compact_summary = Some(false);
    assert!(!is_parsed_compact_message(&msg));
}

#[test]
fn test_compact_none_not_compact() {
    let msg = make_user_msg("content", false);
    assert!(!is_parsed_compact_message(&msg));
}

// is_parsed_teammate_message

#[test]
fn test_teammate_message_excluded_from_user_chunk() {
    let msg = make_user_msg(
        r#"<teammate-message teammate_id="agent1" color="blue" summary="done">result</teammate-message>"#,
        false,
    );
    assert!(is_parsed_teammate_message(&msg));
    assert!(!is_parsed_user_chunk_message(&msg));
}

#[test]
fn test_teammate_message_in_blocks() {
    let msg = make_blocks_msg(
        vec![ContentBlock::Text {
            text: r#"<teammate-message teammate_id="a2" color="red" summary="ok">data</teammate-message>"#.to_string(),
        }],
        false,
    );
    assert!(is_parsed_teammate_message(&msg));
}

#[test]
fn test_teammate_message_meta_rejected() {
    let msg = make_user_msg(
        r#"<teammate-message teammate_id="a1" color="blue" summary="x">y</teammate-message>"#,
        true,
    );
    assert!(!is_parsed_teammate_message(&msg));
}

#[test]
fn test_teammate_message_non_user_rejected() {
    let mut msg = make_user_msg(
        r#"<teammate-message teammate_id="a1" color="blue" summary="x">y</teammate-message>"#,
        false,
    );
    msg.message_type = "assistant".to_string();
    assert!(!is_parsed_teammate_message(&msg));
}

#[test]
fn test_not_teammate_message() {
    let msg = make_user_msg("regular user message", false);
    assert!(!is_parsed_teammate_message(&msg));
}

// Boundary cases

#[test]
fn test_real_user_message_unicode() {
    let msg = make_user_msg("héllo 🚀 世界", false);
    assert!(is_parsed_real_user_message(&msg));
}

#[test]
fn test_real_user_message_long_content() {
    let long = "x".repeat(10_000);
    let msg = make_user_msg(&long, false);
    assert!(
        is_parsed_real_user_message(&msg),
        "long but non-meta content is still a real user message"
    );
}
