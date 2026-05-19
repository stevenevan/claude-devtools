/// Incremental delta and chunk-shape helpers.
///
/// `build_chunks_incremental` is the public entry point used by the
/// Tauri layer to ship only the chunks that changed since the last
/// parse — the rest of the chunks the renderer already has are kept.
use crate::types::chunks::{EnhancedChunk, Process};
use crate::types::messages::ParsedMessage;

use super::chunk_builder::build_chunks;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkDelta {
    /// Index of the first changed chunk (the last existing chunk may be replaced
    /// if it was an in-progress AI chunk that grew).
    pub replace_from_index: usize,
    /// The new/modified chunks starting at `replace_from_index`.
    pub chunks: Vec<EnhancedChunk>,
}

pub fn chunk_id(chunk: &EnhancedChunk) -> &str {
    match chunk {
        EnhancedChunk::User(c) => &c.id,
        EnhancedChunk::Ai(c) => &c.id,
        EnhancedChunk::System(c) => &c.id,
        EnhancedChunk::Compact(c) => &c.id,
        EnhancedChunk::Event(c) => &c.id,
    }
}

pub fn chunk_raw_count(chunk: &EnhancedChunk) -> usize {
    match chunk {
        EnhancedChunk::User(c) => c.raw_messages.len(),
        EnhancedChunk::Ai(c) => c.raw_messages.len(),
        EnhancedChunk::System(c) => c.raw_messages.len(),
        EnhancedChunk::Compact(c) => c.raw_messages.len(),
        EnhancedChunk::Event(c) => c.raw_messages.len(),
    }
}

/// Build chunks incrementally: rebuild from combined messages and return
/// a delta describing which chunks changed.
///
/// Strategy: rebuild all chunks from combined messages (fast in-memory O(n)),
/// then compare against existing chunks to find the first divergence point.
pub fn build_chunks_incremental(
    all_messages: &[ParsedMessage],
    subagents: &[Process],
    existing_chunk_count: usize,
) -> ChunkDelta {
    let new_chunks = build_chunks(all_messages, subagents);

    let mut replace_from = existing_chunk_count;

    // The last existing chunk might have changed (e.g., AI chunk grew with
    // more messages), so conservatively start replacement from one before
    // the end when there were existing chunks.
    if existing_chunk_count > 0 && new_chunks.len() >= existing_chunk_count {
        let last_idx = existing_chunk_count - 1;
        replace_from = last_idx;
    }

    ChunkDelta {
        replace_from_index: replace_from,
        chunks: new_chunks[replace_from..].to_vec(),
    }
}
