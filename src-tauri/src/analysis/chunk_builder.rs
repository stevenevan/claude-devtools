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
    let mut progress_count: u32 = 0;

    for msg in &main_messages {
        let category = categorize_message(msg);

        match category {
            MessageCategory::HardNoise => {
                // Count progress messages for AI chunk enrichment
                if msg.message_type == "progress" {
                    progress_count += 1;
                }
            }
            MessageCategory::Compact
            | MessageCategory::User
            | MessageCategory::System
            | MessageCategory::Event => {
                if !ai_buffer.is_empty() {
                    let pc = if progress_count > 0 { Some(progress_count) } else { None };
                    chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages, pc));
                    ai_buffer.clear();
                    progress_count = 0;
                }
                match category {
                    MessageCategory::Compact => chunks.push(build_compact_chunk(msg)),
                    MessageCategory::User => chunks.push(build_user_chunk(msg)),
                    MessageCategory::System => chunks.push(build_system_chunk(msg)),
                    MessageCategory::Event => chunks.push(build_event_chunk(msg)),
                    _ => unreachable!(),
                }
            }
            MessageCategory::Ai => {
                ai_buffer.push((*msg).clone());
            }
        }
    }

    // Flush remaining
    if !ai_buffer.is_empty() {
        let pc = if progress_count > 0 { Some(progress_count) } else { None };
        chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages, pc));
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
