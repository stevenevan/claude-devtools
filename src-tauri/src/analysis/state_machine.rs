/// State machine used by `chunk_builder::build_chunks` while walking the
/// main-thread message timeline.
///
/// Pushes AI messages into a buffer; on the next non-AI message the buffer
/// is flushed into a single AI chunk. Progress messages (HardNoise) are
/// tracked separately so the AI chunk can be enriched with progress
/// metadata at flush time.
use crate::types::chunks::{EnhancedChunk, Process};
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

use super::chunk_factory::build_ai_chunk_from_buffer;

#[derive(Default)]
pub struct ChunkBuildState {
    ai_buffer: Vec<ParsedMessage>,
    progress_count: u32,
    progress_texts: Vec<String>,
}

impl ChunkBuildState {
    pub fn push_ai(&mut self, msg: &ParsedMessage) {
        self.ai_buffer.push(msg.clone());
    }

    pub fn track_progress(&mut self, msg: &ParsedMessage) {
        if msg.message_type != "progress" {
            return;
        }
        self.progress_count += 1;
        if let ParsedMessageContent::Text(ref text) = msg.content {
            if !text.is_empty() {
                self.progress_texts.push(text.clone());
            }
        }
    }

    pub fn has_pending_ai(&self) -> bool {
        !self.ai_buffer.is_empty()
    }

    /// Flush the AI buffer (if any) into a chunk and reset progress counters.
    /// Returns the new chunk to append, or None when there was nothing buffered.
    pub fn flush_ai_chunk(
        &mut self,
        subagents: &[Process],
        all_messages: &[ParsedMessage],
    ) -> Option<EnhancedChunk> {
        if self.ai_buffer.is_empty() {
            return None;
        }
        let pc = if self.progress_count > 0 {
            Some(self.progress_count)
        } else {
            None
        };
        let pt = if self.progress_texts.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.progress_texts))
        };
        let chunk = build_ai_chunk_from_buffer(&self.ai_buffer, subagents, all_messages, pc, pt);
        self.ai_buffer.clear();
        self.progress_count = 0;
        Some(chunk)
    }
}
