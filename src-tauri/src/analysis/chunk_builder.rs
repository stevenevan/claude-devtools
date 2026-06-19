/// Orchestrator: build chunks from messages using state machine classification.
///
/// The AI-buffer state machine and incremental delta logic live in their own
/// modules to keep this file focused on the high-level walk.
use crate::parsing::message_classifier::categorize_message;
use crate::parsing::metrics::calculate_metrics;
use crate::types::chunks::{EnhancedChunk, Process, SessionDetail};
use crate::types::domain::Session;
use crate::types::messages::{MessageCategory, ParsedMessage};

use super::chunk_factory::{build_compact_chunk, build_event_chunk, build_system_chunk, build_user_chunk};
use super::state_machine::ChunkBuildState;

/// Filters to main thread, classifies, and uses a state machine with AI buffer.
#[tracing::instrument(
    skip_all,
    fields(
        message_count = messages.len(),
        subagent_count = subagents.len(),
        chunk_count = tracing::field::Empty,
        elapsed_ms = tracing::field::Empty,
    )
)]
pub fn build_chunks(messages: &[ParsedMessage], subagents: &[Process]) -> Vec<EnhancedChunk> {
    let start = std::time::Instant::now();
    let mut chunks = Vec::new();
    let mut state = ChunkBuildState::default();

    let main_messages: Vec<&ParsedMessage> = messages.iter().filter(|m| !m.is_sidechain).collect();

    for msg in &main_messages {
        let category = categorize_message(msg);

        match category {
            MessageCategory::HardNoise => state.track_progress(msg),
            MessageCategory::Compact
            | MessageCategory::User
            | MessageCategory::System
            | MessageCategory::Event => {
                if let Some(ai_chunk) = state.flush_ai_chunk(subagents, messages) {
                    chunks.push(ai_chunk);
                }
                match category {
                    MessageCategory::Compact => chunks.push(build_compact_chunk(msg)),
                    MessageCategory::User => chunks.push(build_user_chunk(msg)),
                    MessageCategory::System => chunks.push(build_system_chunk(msg)),
                    MessageCategory::Event => chunks.push(build_event_chunk(msg)),
                    _ => unreachable!(),
                }
            }
            MessageCategory::Ai => state.push_ai(msg),
        }
    }

    if let Some(ai_chunk) = state.flush_ai_chunk(subagents, messages) {
        chunks.push(ai_chunk);
    }

    let span = tracing::Span::current();
    span.record("chunk_count", chunks.len());
    span.record("elapsed_ms", start.elapsed().as_millis() as u64);
    chunks
}

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

#[cfg(test)]
#[path = "chunk_builder_tests.rs"]
mod chunk_tests;
