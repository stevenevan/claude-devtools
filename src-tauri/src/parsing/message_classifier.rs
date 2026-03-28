/// Message classification — port of TypeScript type guards from messages.ts.

use regex::Regex;
use std::sync::LazyLock;

use crate::types::constants::*;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{MessageCategory, ParsedMessage, ParsedMessageContent};

// =============================================================================
// Type Guards
// =============================================================================

/// Real user message: type=user, !isMeta, has text/image content.
pub fn is_parsed_real_user_message(msg: &ParsedMessage) -> bool {
    if msg.message_type != "user" || msg.is_meta {
        return false;
    }

    match &msg.content {
        ParsedMessageContent::Text(_) => true,
        ParsedMessageContent::Blocks(blocks) => blocks
            .iter()
            .any(|b| matches!(b, ContentBlock::Text { .. } | ContentBlock::Image { .. })),
    }
}

/// User chunk message: genuine user input that starts User chunks.
/// Excludes system output tags, teammate messages, interruptions.
pub fn is_parsed_user_chunk_message(msg: &ParsedMessage) -> bool {
    if msg.message_type != "user" || msg.is_meta {
        return false;
    }
    if is_parsed_teammate_message(msg) {
        return false;
    }

    match &msg.content {
        ParsedMessageContent::Text(text) => {
            let trimmed = text.trim();
            // Exclude system output tags
            for tag in SYSTEM_OUTPUT_TAGS {
                if trimmed.starts_with(tag) {
                    return false;
                }
            }
            !trimmed.is_empty()
        }
        ParsedMessageContent::Blocks(blocks) => {
            let has_user_content = blocks
                .iter()
                .any(|b| matches!(b, ContentBlock::Text { .. } | ContentBlock::Image { .. }));

            if !has_user_content {
                return false;
            }

            // Filter interruption messages
            if blocks.len() == 1 {
                if let ContentBlock::Text { text } = &blocks[0] {
                    if text.starts_with("[Request interrupted by user") {
                        return false;
                    }
                }
            }

            // Check text blocks for excluded tags
            for block in blocks {
                if let ContentBlock::Text { text } = block {
                    for tag in SYSTEM_OUTPUT_TAGS {
                        if text.starts_with(tag) {
                            return false;
                        }
                    }
                }
            }

            true
        }
    }
}

/// System chunk message: command output with <local-command-stdout>.
pub fn is_parsed_system_chunk_message(msg: &ParsedMessage) -> bool {
    if msg.message_type != "user" {
        return false;
    }

    match &msg.content {
        ParsedMessageContent::Text(text) => {
            text.starts_with(LOCAL_COMMAND_STDOUT_TAG)
                || text.starts_with(LOCAL_COMMAND_STDERR_TAG)
        }
        ParsedMessageContent::Blocks(blocks) => blocks.iter().any(|b| {
            if let ContentBlock::Text { text } = b {
                text.starts_with(LOCAL_COMMAND_STDOUT_TAG)
            } else {
                false
            }
        }),
    }
}

/// Event message — displayable system subtypes and queue operations.
pub fn is_parsed_event_message(msg: &ParsedMessage) -> bool {
    if msg.message_type == "system" {
        return matches!(
            msg.subtype.as_deref(),
            Some("api_error" | "bridge_status" | "memory_saved" | "turn_duration")
        );
    }
    if msg.message_type == "queue-operation" {
        return true;
    }
    false
}

/// Hard noise message — NEVER rendered.
pub fn is_parsed_hard_noise_message(msg: &ParsedMessage) -> bool {
    // Filter structural metadata types
    match msg.message_type.as_str() {
        "system" => {
            // Allow displayable system event subtypes through
            if let Some(ref subtype) = msg.subtype {
                if matches!(
                    subtype.as_str(),
                    "api_error" | "bridge_status" | "memory_saved" | "turn_duration"
                ) {
                    return false;
                }
            }
            return true;
        }
        "summary" | "file-history-snapshot" | "progress" => return true,
        _ => {}
    }

    // Filter synthetic assistant messages
    if msg.message_type == "assistant" {
        if let Some(ref model) = msg.model {
            if model == "<synthetic>" {
                return true;
            }
        }
    }

    // Filter user messages with only noise tags
    if msg.message_type == "user" {
        match &msg.content {
            ParsedMessageContent::Text(text) => {
                let trimmed = text.trim();

                // Wrapped in noise tag
                for tag in HARD_NOISE_TAGS {
                    let close_tag = tag.replace('<', "</");
                    if trimmed.starts_with(tag) && trimmed.ends_with(&close_tag) {
                        return true;
                    }
                }

                // Empty command output
                if trimmed == EMPTY_STDOUT || trimmed == EMPTY_STDERR {
                    return true;
                }

                // Interruption messages
                if trimmed.starts_with("[Request interrupted by user") {
                    return true;
                }
            }
            ParsedMessageContent::Blocks(blocks) => {
                // Single interruption text block
                if blocks.len() == 1 {
                    if let ContentBlock::Text { text } = &blocks[0] {
                        if text.starts_with("[Request interrupted by user") {
                            return true;
                        }
                    }
                }
            }
        }
    }

    false
}

/// Compact summary message.
pub fn is_parsed_compact_message(msg: &ParsedMessage) -> bool {
    msg.is_compact_summary == Some(true)
}

/// Teammate message — <teammate-message teammate_id="...">
static TEAMMATE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^<teammate-message\s+teammate_id="([^"]+)""#).unwrap());

pub fn is_parsed_teammate_message(msg: &ParsedMessage) -> bool {
    if msg.message_type != "user" || msg.is_meta {
        return false;
    }

    match &msg.content {
        ParsedMessageContent::Text(text) => TEAMMATE_REGEX.is_match(text.trim()),
        ParsedMessageContent::Blocks(blocks) => blocks.iter().any(|b| {
            if let ContentBlock::Text { text } = b {
                TEAMMATE_REGEX.is_match(text.trim())
            } else {
                false
            }
        }),
    }
}

// =============================================================================
// Message Categorization
// =============================================================================

/// Categorize a parsed message into one of the six categories.
/// Order matters: event → hardNoise → compact → system → user → ai
pub fn categorize_message(msg: &ParsedMessage) -> MessageCategory {
    if is_parsed_event_message(msg) {
        return MessageCategory::Event;
    }
    if is_parsed_hard_noise_message(msg) {
        return MessageCategory::HardNoise;
    }
    if is_parsed_compact_message(msg) {
        return MessageCategory::Compact;
    }
    if is_parsed_system_chunk_message(msg) {
        return MessageCategory::System;
    }
    if is_parsed_user_chunk_message(msg) {
        return MessageCategory::User;
    }
    MessageCategory::Ai
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_user_msg(content: &str, is_meta: bool) -> ParsedMessage {
        ParsedMessage {
            uuid: "u1".to_string(),
            parent_uuid: None,
            message_type: "user".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some("user".to_string()),
            content: ParsedMessageContent::Text(content.to_string()),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
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

    fn make_blocks_msg(blocks: Vec<ContentBlock>, is_meta: bool) -> ParsedMessage {
        ParsedMessage {
            uuid: "u1".to_string(),
            parent_uuid: None,
            message_type: "user".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some("user".to_string()),
            content: ParsedMessageContent::Blocks(blocks),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
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

    // =========================================================================
    // is_parsed_real_user_message
    // =========================================================================

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
            vec![ContentBlock::Text {
                text: "hello".to_string(),
            }],
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

    // =========================================================================
    // is_parsed_user_chunk_message
    // =========================================================================

    #[test]
    fn test_user_chunk_message() {
        let msg = make_user_msg("help me debug this", false);
        assert!(is_parsed_user_chunk_message(&msg));
        assert_eq!(categorize_message(&msg), MessageCategory::User);
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
            assert!(
                !is_parsed_user_chunk_message(&msg),
                "Should exclude tag: {tag}"
            );
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
            vec![ContentBlock::Text {
                text: "Please fix this bug".to_string(),
            }],
            false,
        );
        assert!(is_parsed_user_chunk_message(&msg));
    }

    // =========================================================================
    // is_parsed_system_chunk_message
    // =========================================================================

    #[test]
    fn test_system_chunk_stdout() {
        let msg = make_user_msg("<local-command-stdout>output</local-command-stdout>", false);
        assert!(is_parsed_system_chunk_message(&msg));
        assert!(!is_parsed_user_chunk_message(&msg));
        assert_eq!(categorize_message(&msg), MessageCategory::System);
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

    // =========================================================================
    // is_parsed_event_message
    // =========================================================================

    #[test]
    fn test_event_api_error() {
        let mut msg = make_user_msg("", false);
        msg.message_type = "system".to_string();
        msg.subtype = Some("api_error".to_string());
        assert!(is_parsed_event_message(&msg));
        assert_eq!(categorize_message(&msg), MessageCategory::Event);
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

    // =========================================================================
    // is_parsed_hard_noise_message
    // =========================================================================

    #[test]
    fn test_hard_noise_caveat() {
        let msg = make_user_msg(
            "<local-command-caveat>caveat text</local-command-caveat>",
            false,
        );
        assert!(is_parsed_hard_noise_message(&msg));
        assert_eq!(categorize_message(&msg), MessageCategory::HardNoise);
    }

    #[test]
    fn test_hard_noise_system_reminder() {
        let msg = make_user_msg(
            "<system-reminder>reminder text</system-reminder>",
            false,
        );
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
            vec![ContentBlock::Text {
                text: "[Request interrupted by user]".to_string(),
            }],
            false,
        );
        assert!(is_parsed_hard_noise_message(&msg));
    }

    #[test]
    fn test_regular_user_message_not_hard_noise() {
        let msg = make_user_msg("please fix the bug", false);
        assert!(!is_parsed_hard_noise_message(&msg));
    }

    // =========================================================================
    // is_parsed_compact_message
    // =========================================================================

    #[test]
    fn test_compact_message() {
        let mut msg = make_user_msg("", false);
        msg.is_compact_summary = Some(true);
        assert!(is_parsed_compact_message(&msg));
        assert_eq!(categorize_message(&msg), MessageCategory::Compact);
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

    // =========================================================================
    // is_parsed_teammate_message
    // =========================================================================

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

    // =========================================================================
    // categorize_message — priority ordering
    // =========================================================================

    #[test]
    fn test_assistant_categorized_as_ai() {
        let mut msg = make_user_msg("response", false);
        msg.message_type = "assistant".to_string();
        msg.role = Some("assistant".to_string());
        assert_eq!(categorize_message(&msg), MessageCategory::Ai);
    }

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
        // Meta user message (tool result) — not a user chunk, not system, not noise → Ai fallback
        let msg = make_user_msg("tool output", true);
        assert_eq!(categorize_message(&msg), MessageCategory::Ai);
    }
}
