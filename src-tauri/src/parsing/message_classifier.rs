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

/// System event message — displayable system subtypes.
pub fn is_parsed_event_message(msg: &ParsedMessage) -> bool {
    if msg.message_type != "system" {
        return false;
    }
    matches!(
        msg.subtype.as_deref(),
        Some("api_error" | "bridge_status" | "memory_saved")
    )
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
                    "api_error" | "bridge_status" | "memory_saved"
                ) {
                    return false;
                }
            }
            return true;
        }
        "summary" | "file-history-snapshot" | "queue-operation" => return true,
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
    fn test_system_chunk_stdout() {
        let msg = make_user_msg("<local-command-stdout>output</local-command-stdout>", false);
        assert!(is_parsed_system_chunk_message(&msg));
        assert!(!is_parsed_user_chunk_message(&msg));
        assert_eq!(categorize_message(&msg), MessageCategory::System);
    }

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
    fn test_hard_noise_interruption() {
        let msg = make_user_msg("[Request interrupted by user]", false);
        assert!(is_parsed_hard_noise_message(&msg));
    }

    #[test]
    fn test_hard_noise_system_type() {
        let mut msg = make_user_msg("", false);
        msg.message_type = "system".to_string();
        assert!(is_parsed_hard_noise_message(&msg));
    }

    #[test]
    fn test_hard_noise_synthetic_assistant() {
        let mut msg = make_user_msg("", false);
        msg.message_type = "assistant".to_string();
        msg.model = Some("<synthetic>".to_string());
        assert!(is_parsed_hard_noise_message(&msg));
    }

    #[test]
    fn test_user_chunk_message() {
        let msg = make_user_msg("help me debug this", false);
        assert!(is_parsed_user_chunk_message(&msg));
        assert_eq!(categorize_message(&msg), MessageCategory::User);
    }

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
    fn test_compact_message() {
        let mut msg = make_user_msg("", false);
        msg.is_compact_summary = Some(true);
        assert!(is_parsed_compact_message(&msg));
        assert_eq!(categorize_message(&msg), MessageCategory::Compact);
    }

    #[test]
    fn test_assistant_categorized_as_ai() {
        let mut msg = make_user_msg("response", false);
        msg.message_type = "assistant".to_string();
        msg.role = Some("assistant".to_string());
        assert_eq!(categorize_message(&msg), MessageCategory::Ai);
    }
}
