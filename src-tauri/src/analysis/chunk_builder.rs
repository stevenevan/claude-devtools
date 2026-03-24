/// Orchestrator: build chunks from messages using state machine classification.

use crate::parsing::message_classifier::categorize_message;
use crate::parsing::metrics::calculate_metrics;
use crate::types::chunks::{EnhancedChunk, Process, SessionDetail};
use crate::types::domain::Session;
use crate::types::messages::{MessageCategory, ParsedMessage, ParsedMessageContent};

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
    let mut progress_texts: Vec<String> = Vec::new();

    for msg in &main_messages {
        let category = categorize_message(msg);

        match category {
            MessageCategory::HardNoise => {
                // Count progress messages and collect their text for AI chunk enrichment
                if msg.message_type == "progress" {
                    progress_count += 1;
                    if let ParsedMessageContent::Text(ref text) = msg.content {
                        if !text.is_empty() {
                            progress_texts.push(text.clone());
                        }
                    }
                }
            }
            MessageCategory::Compact
            | MessageCategory::User
            | MessageCategory::System
            | MessageCategory::Event => {
                if !ai_buffer.is_empty() {
                    let pc = if progress_count > 0 { Some(progress_count) } else { None };
                    let pt = if progress_texts.is_empty() { None } else { Some(std::mem::take(&mut progress_texts)) };
                    chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages, pc, pt));
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
        let pt = if progress_texts.is_empty() { None } else { Some(progress_texts) };
        chunks.push(build_ai_chunk_from_buffer(&ai_buffer, subagents, messages, pc, pt));
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

// =============================================================================
// Incremental chunk building
// =============================================================================

/// Delta produced by incremental chunk building.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkDelta {
    /// Index of the first changed chunk (the last existing chunk may be replaced
    /// if it was an in-progress AI chunk that grew).
    pub replace_from_index: usize,
    /// The new/modified chunks starting at `replace_from_index`.
    pub chunks: Vec<EnhancedChunk>,
}

/// Get the chunk ID from an EnhancedChunk.
fn chunk_id(chunk: &EnhancedChunk) -> &str {
    match chunk {
        EnhancedChunk::User(c) => &c.id,
        EnhancedChunk::Ai(c) => &c.id,
        EnhancedChunk::System(c) => &c.id,
        EnhancedChunk::Compact(c) => &c.id,
        EnhancedChunk::Event(c) => &c.id,
    }
}

/// Get the count of raw_messages in a chunk (used to detect if a chunk changed).
fn chunk_raw_count(chunk: &EnhancedChunk) -> usize {
    match chunk {
        EnhancedChunk::User(c) => c.raw_messages.len(),
        EnhancedChunk::Ai(c) => c.raw_messages.len(),
        EnhancedChunk::System(c) => c.raw_messages.len(),
        EnhancedChunk::Compact(c) => c.raw_messages.len(),
        EnhancedChunk::Event(c) => c.raw_messages.len(),
    }
}

/// Build chunks incrementally: given all messages (old + new) and existing chunks,
/// rebuild only what changed and return a delta.
///
/// Strategy: rebuild all chunks from combined messages (fast in-memory O(n)), then
/// compare against existing chunks to find the first divergence point.
pub fn build_chunks_incremental(
    all_messages: &[ParsedMessage],
    subagents: &[Process],
    existing_chunk_count: usize,
) -> ChunkDelta {
    let new_chunks = build_chunks(all_messages, subagents);

    // Find the first index where chunks diverge.
    // Existing chunks are immutable except potentially the last one (an AI chunk
    // that was flushed at end-of-parse may have grown with new messages).
    let mut replace_from = existing_chunk_count;

    // The last existing chunk might have changed (e.g., AI chunk grew with more
    // messages), so we conservatively start replacement from one before the end
    // if there were existing chunks.
    if existing_chunk_count > 0 && new_chunks.len() >= existing_chunk_count {
        // Check if the last existing chunk is unchanged by comparing raw_message counts.
        // This is a fast heuristic — if the count matches, the chunk is likely unchanged.
        // For true equality we'd need deep comparison, but count is sufficient for streaming.
        let last_idx = existing_chunk_count - 1;
        // We can't access existing chunks here (we only have count), so conservatively
        // replace from the last chunk.
        replace_from = last_idx;
    }

    ChunkDelta {
        replace_from_index: replace_from,
        chunks: new_chunks[replace_from..].to_vec(),
    }
}
