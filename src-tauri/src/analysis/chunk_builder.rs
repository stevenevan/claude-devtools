/// Orchestrator: build chunks from messages using state machine classification.

use crate::parsing::message_classifier::categorize_message;
use crate::parsing::metrics::calculate_metrics;
use crate::types::chunks::{EnhancedChunk, Process, SessionDetail};
use crate::types::domain::Session;
use crate::types::messages::{MessageCategory, ParsedMessage};

use super::chunk_factory::{
    build_ai_chunk_from_buffer, build_compact_chunk, build_event_chunk, build_system_chunk,
    build_user_chunk,
};

/// Build chunks from messages.
/// Filters to main thread, classifies, and uses a state machine with AI buffer.
pub fn build_chunks(messages: &[ParsedMessage], subagents: &[Process]) -> Vec<EnhancedChunk> {
    let mut chunks = Vec::new();

    // Filter to main thread messages
    let main_messages: Vec<&ParsedMessage> = messages.iter().filter(|m| !m.is_sidechain).collect();

    let mut ai_buffer: Vec<ParsedMessage> = Vec::new();

    for msg in &main_messages {
        let category = categorize_message(msg);

        match category {
            MessageCategory::HardNoise => {
                // Skip
            }
            MessageCategory::Compact => {
                if !ai_buffer.is_empty() {
                    chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages));
                    ai_buffer.clear();
                }
                chunks.push(build_compact_chunk(msg));
            }
            MessageCategory::User => {
                if !ai_buffer.is_empty() {
                    chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages));
                    ai_buffer.clear();
                }
                chunks.push(build_user_chunk(msg));
            }
            MessageCategory::System => {
                if !ai_buffer.is_empty() {
                    chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages));
                    ai_buffer.clear();
                }
                chunks.push(build_system_chunk(msg));
            }
            MessageCategory::Event => {
                if !ai_buffer.is_empty() {
                    chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages));
                    ai_buffer.clear();
                }
                chunks.push(build_event_chunk(msg));
            }
            MessageCategory::Ai => {
                ai_buffer.push((*msg).clone());
            }
        }
    }

    // Flush remaining
    if !ai_buffer.is_empty() {
        chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages));
    }

    chunks
}

/// Build a complete SessionDetail.
pub fn build_session_detail(
    session: Session,
    messages: Vec<ParsedMessage>,
    subagents: Vec<Process>,
) -> SessionDetail {
    let chunks = build_chunks(&messages, &subagents);
    let metrics = calculate_metrics(&messages);

    SessionDetail {
        session,
        messages,
        chunks,
        processes: subagents,
        metrics,
    }
}
