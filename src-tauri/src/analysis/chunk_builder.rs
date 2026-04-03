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

// Incremental chunk building

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::messages::{ParsedMessageContent, SystemEventData, TokenUsage};

    fn make_msg(uuid: &str, msg_type: &str, is_meta: bool, is_sidechain: bool) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: msg_type.to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some(msg_type.to_string()),
            content: ParsedMessageContent::Text("test".to_string()),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain,
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

    fn make_assistant(uuid: &str, ts: &str) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: "assistant".to_string(),
            timestamp: ts.to_string(),
            role: Some("assistant".to_string()),
            content: ParsedMessageContent::Text("response".to_string()),
            usage: Some(TokenUsage {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: None,
                cache_creation_input_tokens: None,
            }),
            model: Some("claude-sonnet-4-20250514".to_string()),
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
            is_meta: false,
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

    fn is_user_chunk(c: &EnhancedChunk) -> bool {
        matches!(c, EnhancedChunk::User(_))
    }
    fn is_ai_chunk(c: &EnhancedChunk) -> bool {
        matches!(c, EnhancedChunk::Ai(_))
    }
    fn is_system_chunk(c: &EnhancedChunk) -> bool {
        matches!(c, EnhancedChunk::System(_))
    }
    fn is_compact_chunk(c: &EnhancedChunk) -> bool {
        matches!(c, EnhancedChunk::Compact(_))
    }
    fn is_event_chunk(c: &EnhancedChunk) -> bool {
        matches!(c, EnhancedChunk::Event(_))
    }

    // =========================================================================
    // build_chunks — basic patterns
    // =========================================================================

    #[test]
    fn test_empty_messages() {
        let chunks = build_chunks(&[], &[]);
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_single_user_message() {
        let msgs = vec![make_msg("u1", "user", false, false)];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 1);
        assert!(is_user_chunk(&chunks[0]));
    }

    #[test]
    fn test_single_assistant_message() {
        let msgs = vec![make_assistant("a1", "2024-01-01T00:00:00Z")];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 1);
        assert!(is_ai_chunk(&chunks[0]));
    }

    #[test]
    fn test_user_then_assistant() {
        let msgs = vec![
            make_msg("u1", "user", false, false),
            make_assistant("a1", "2024-01-01T00:01:00Z"),
        ];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 2);
        assert!(is_user_chunk(&chunks[0]));
        assert!(is_ai_chunk(&chunks[1]));
    }

    #[test]
    fn test_user_assistant_user_assistant() {
        let msgs = vec![
            make_msg("u1", "user", false, false),
            make_assistant("a1", "2024-01-01T00:01:00Z"),
            make_msg("u2", "user", false, false),
            make_assistant("a2", "2024-01-01T00:02:00Z"),
        ];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 4);
        assert!(is_user_chunk(&chunks[0]));
        assert!(is_ai_chunk(&chunks[1]));
        assert!(is_user_chunk(&chunks[2]));
        assert!(is_ai_chunk(&chunks[3]));
    }

    // =========================================================================
    // AI buffer flushing
    // =========================================================================

    #[test]
    fn test_multiple_assistants_buffered_into_single_ai_chunk() {
        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z"),
            make_assistant("a2", "2024-01-01T00:00:01Z"),
            make_assistant("a3", "2024-01-01T00:00:02Z"),
        ];
        let chunks = build_chunks(&msgs, &[]);
        // All assistants should be in one AI chunk (no user message to flush)
        assert_eq!(chunks.len(), 1);
        assert!(is_ai_chunk(&chunks[0]));
        if let EnhancedChunk::Ai(ref ai) = chunks[0] {
            assert_eq!(ai.responses.len(), 3);
        }
    }

    #[test]
    fn test_user_message_flushes_ai_buffer() {
        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z"),
            make_assistant("a2", "2024-01-01T00:00:01Z"),
            make_msg("u1", "user", false, false),
            make_assistant("a3", "2024-01-01T00:00:03Z"),
        ];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 3);
        assert!(is_ai_chunk(&chunks[0])); // a1 + a2
        assert!(is_user_chunk(&chunks[1])); // u1
        assert!(is_ai_chunk(&chunks[2])); // a3
        if let EnhancedChunk::Ai(ref ai) = chunks[0] {
            assert_eq!(ai.responses.len(), 2);
        }
    }

    // =========================================================================
    // System chunk message
    // =========================================================================

    #[test]
    fn test_system_chunk_in_sequence() {
        let mut sys = make_msg("s1", "user", false, false);
        sys.content = ParsedMessageContent::Text(
            "<local-command-stdout>output</local-command-stdout>".to_string(),
        );

        let msgs = vec![
            make_msg("u1", "user", false, false),
            make_assistant("a1", "2024-01-01T00:01:00Z"),
            sys,
        ];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 3);
        assert!(is_user_chunk(&chunks[0]));
        assert!(is_ai_chunk(&chunks[1]));
        assert!(is_system_chunk(&chunks[2]));
    }

    // =========================================================================
    // Compact message
    // =========================================================================

    #[test]
    fn test_compact_chunk_in_sequence() {
        let mut compact = make_msg("c1", "user", false, false);
        compact.is_compact_summary = Some(true);

        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z"),
            compact,
            make_msg("u1", "user", false, false),
        ];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 3);
        assert!(is_ai_chunk(&chunks[0]));
        assert!(is_compact_chunk(&chunks[1]));
        assert!(is_user_chunk(&chunks[2]));
    }

    // =========================================================================
    // Event message
    // =========================================================================

    #[test]
    fn test_event_chunk_in_sequence() {
        let mut event = make_msg("e1", "system", false, false);
        event.subtype = Some("api_error".to_string());
        event.event_data = Some(SystemEventData {
            subtype: "api_error".to_string(),
            ..Default::default()
        });

        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z"),
            event,
        ];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 2);
        assert!(is_ai_chunk(&chunks[0]));
        assert!(is_event_chunk(&chunks[1]));
    }

    // =========================================================================
    // Hard noise filtering
    // =========================================================================

    #[test]
    fn test_hard_noise_filtered_out() {
        let mut noise = make_msg("n1", "summary", false, false);
        noise.message_type = "summary".to_string();

        let msgs = vec![
            make_msg("u1", "user", false, false),
            noise,
            make_assistant("a1", "2024-01-01T00:01:00Z"),
        ];
        let chunks = build_chunks(&msgs, &[]);
        // summary is hard noise, should be skipped
        assert_eq!(chunks.len(), 2);
        assert!(is_user_chunk(&chunks[0]));
        assert!(is_ai_chunk(&chunks[1]));
    }

    #[test]
    fn test_sidechain_messages_filtered_out() {
        let msgs = vec![
            make_msg("u1", "user", false, false),
            make_msg("sc1", "user", false, true), // sidechain
            make_assistant("a1", "2024-01-01T00:01:00Z"),
        ];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 2);
    }

    // =========================================================================
    // Progress message enrichment
    // =========================================================================

    #[test]
    fn test_progress_messages_counted_for_ai_chunk() {
        let mut prog1 = make_msg("p1", "progress", false, false);
        prog1.content = ParsedMessageContent::Text("Step 1/3".to_string());
        let mut prog2 = make_msg("p2", "progress", false, false);
        prog2.content = ParsedMessageContent::Text("Step 2/3".to_string());

        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z"),
            prog1,
            prog2,
            make_msg("u1", "user", false, false),
        ];
        let chunks = build_chunks(&msgs, &[]);
        assert_eq!(chunks.len(), 2);
        if let EnhancedChunk::Ai(ref ai) = chunks[0] {
            assert_eq!(ai.progress_count, Some(2));
            assert_eq!(ai.progress_texts.as_ref().unwrap().len(), 2);
        } else {
            panic!("expected AI chunk");
        }
    }

    #[test]
    fn test_no_progress_messages() {
        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z"),
            make_msg("u1", "user", false, false),
        ];
        let chunks = build_chunks(&msgs, &[]);
        if let EnhancedChunk::Ai(ref ai) = chunks[0] {
            assert!(ai.progress_count.is_none());
            assert!(ai.progress_texts.is_none());
        }
    }

    // =========================================================================
    // Chunk IDs
    // =========================================================================

    #[test]
    fn test_chunk_ids_are_unique() {
        let msgs = vec![
            make_msg("u1", "user", false, false),
            make_assistant("a1", "2024-01-01T00:01:00Z"),
            make_msg("u2", "user", false, false),
        ];
        let chunks = build_chunks(&msgs, &[]);
        let ids: Vec<&str> = chunks.iter().map(|c| chunk_id(c)).collect();
        assert_eq!(ids.len(), 3);
        // All IDs should be distinct
        let unique: std::collections::HashSet<&&str> = ids.iter().collect();
        assert_eq!(unique.len(), 3);
    }

    // =========================================================================
    // build_chunks_incremental
    // =========================================================================

    #[test]
    fn test_incremental_from_empty() {
        let msgs = vec![
            make_msg("u1", "user", false, false),
            make_assistant("a1", "2024-01-01T00:01:00Z"),
        ];
        let delta = build_chunks_incremental(&msgs, &[], 0);
        assert_eq!(delta.replace_from_index, 0);
        assert_eq!(delta.chunks.len(), 2);
    }

    #[test]
    fn test_incremental_with_existing_chunks() {
        let msgs = vec![
            make_msg("u1", "user", false, false),
            make_assistant("a1", "2024-01-01T00:01:00Z"),
            make_msg("u2", "user", false, false),
        ];
        let delta = build_chunks_incremental(&msgs, &[], 2);
        // Should replace from last existing chunk (index 1)
        assert_eq!(delta.replace_from_index, 1);
        assert!(delta.chunks.len() >= 2);
    }

    // =========================================================================
    // Complex sequence: real-world pattern
    // =========================================================================

    #[test]
    fn test_typical_conversation_pattern() {
        // User → AI (with tool) → meta user (tool result) → AI → User → AI
        let mut tool_result = make_msg("tr1", "user", true, false);
        tool_result.content =
            ParsedMessageContent::Blocks(vec![]); // meta user with blocks

        let msgs = vec![
            make_msg("u1", "user", false, false),             // User chunk
            make_assistant("a1", "2024-01-01T00:00:01Z"),       // AI buffer start
            tool_result,                                        // meta → Ai (categorize fallthrough)
            make_assistant("a2", "2024-01-01T00:00:03Z"),       // Still in AI buffer
            make_msg("u2", "user", false, false),               // Flushes AI buffer → User chunk
            make_assistant("a3", "2024-01-01T00:00:05Z"),       // New AI buffer → flushed at end
        ];
        let chunks = build_chunks(&msgs, &[]);

        // User, AI(a1+tr1+a2), User, AI(a3)
        assert_eq!(chunks.len(), 4);
        assert!(is_user_chunk(&chunks[0]));
        assert!(is_ai_chunk(&chunks[1]));
        assert!(is_user_chunk(&chunks[2]));
        assert!(is_ai_chunk(&chunks[3]));
    }
}
