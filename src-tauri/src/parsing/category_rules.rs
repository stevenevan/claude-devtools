/// Category orchestrator — given a `ParsedMessage`, decides which
/// `MessageCategory` it belongs to by applying the type-guard rules from
/// `content_type.rs` in priority order.
use crate::types::messages::{MessageCategory, ParsedMessage};

use super::content_type::{
    is_parsed_compact_message, is_parsed_event_message, is_parsed_hard_noise_message,
    is_parsed_system_chunk_message, is_parsed_user_chunk_message,
};

/// Categorize a parsed message into one of the six categories.
///
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
#[path = "category_rules_tests.rs"]
mod tests;
