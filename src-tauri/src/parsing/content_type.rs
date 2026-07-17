/// Content-type and role detectors that drive message categorization.
///
/// Each `is_parsed_*` function inspects a single message and returns whether
/// the message belongs to a particular category. They are deliberately
/// side-effect-free so the orchestrator in `category_rules.rs` can compose
/// them in priority order without duplicating logic.
use regex::Regex;
use std::sync::LazyLock;

use crate::types::constants::*;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

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

            if blocks.len() == 1 {
                if let ContentBlock::Text { text } = &blocks[0] {
                    if text.starts_with("[Request interrupted by user") {
                        return false;
                    }
                }
            }

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
    match msg.message_type.as_str() {
        "system" => {
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

    if msg.message_type == "assistant" {
        if let Some(ref model) = msg.model {
            if model == "<synthetic>" {
                return true;
            }
        }
    }

    if msg.message_type == "user" {
        match &msg.content {
            ParsedMessageContent::Text(text) => {
                let trimmed = text.trim();

                for tag in HARD_NOISE_TAGS {
                    let close_tag = tag.replace('<', "</");
                    if trimmed.starts_with(tag) && trimmed.ends_with(&close_tag) {
                        return true;
                    }
                }

                if trimmed == EMPTY_STDOUT || trimmed == EMPTY_STDERR {
                    return true;
                }

                if trimmed.starts_with("[Request interrupted by user") {
                    return true;
                }
            }
            ParsedMessageContent::Blocks(blocks) => {
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

#[cfg(test)]
#[path = "content_type_tests.rs"]
mod tests;
