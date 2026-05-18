/// Message classification — port of TypeScript type guards from messages.ts.
///
/// Split into:
/// - `content_type.rs` — type-guard functions (`is_parsed_*`).
/// - `category_rules.rs` — `categorize_message` orchestrator.
///
/// This module re-exports the public API so existing callers keep their
/// `use crate::parsing::message_classifier::*` import paths.
pub use super::category_rules::categorize_message;
pub use super::content_type::{
    is_parsed_compact_message, is_parsed_event_message, is_parsed_hard_noise_message,
    is_parsed_real_user_message, is_parsed_system_chunk_message, is_parsed_teammate_message,
    is_parsed_user_chunk_message,
};
