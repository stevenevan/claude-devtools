use super::*;
use crate::analysis::flush_rules::chunk_id;
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

// Chunk IDs

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
    let unique: std::collections::HashSet<&&str> = ids.iter().collect();
    assert_eq!(unique.len(), 3);
}

// build_chunks_incremental

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
    assert_eq!(delta.replace_from_index, 1);
    assert!(delta.chunks.len() >= 2);
}

#[test]
fn test_incremental_no_new_messages_returns_empty_chunks() {
    let delta = build_chunks_incremental(&[], &[], 0);
    assert_eq!(delta.replace_from_index, 0);
    assert!(delta.chunks.is_empty());
}

#[test]
fn test_incremental_matches_full_build() {
    let msgs = vec![
        make_msg("u1", "user", false, false),
        make_assistant("a1", "2024-01-01T00:00:01Z"),
        make_msg("u2", "user", false, false),
        make_assistant("a2", "2024-01-01T00:00:02Z"),
    ];
    let full = build_chunks(&msgs, &[]);
    let delta = build_chunks_incremental(&msgs, &[], 0);
    assert_eq!(delta.replace_from_index, 0);
    assert_eq!(delta.chunks.len(), full.len());
    for (i, c) in delta.chunks.iter().enumerate() {
        assert_eq!(
            std::mem::discriminant(c),
            std::mem::discriminant(&full[i]),
            "chunk {i} variant mismatch incremental vs full"
        );
    }
}

// State-machine boundary cases (sprint 56 wave 2)

#[test]
fn test_system_message_flushes_ai_buffer_mid_sequence() {
    let mut sys = make_msg("s1", "user", false, false);
    sys.content = ParsedMessageContent::Text(
        "<local-command-stdout>output</local-command-stdout>".to_string(),
    );
    let msgs = vec![
        make_assistant("a1", "2024-01-01T00:00:00Z"),
        make_assistant("a2", "2024-01-01T00:00:01Z"),
        sys,
        make_assistant("a3", "2024-01-01T00:00:02Z"),
    ];
    let chunks = build_chunks(&msgs, &[]);
    assert_eq!(chunks.len(), 3);
    assert!(is_ai_chunk(&chunks[0]));
    assert!(is_system_chunk(&chunks[1]));
    assert!(is_ai_chunk(&chunks[2]));
    if let EnhancedChunk::Ai(ref ai) = chunks[0] {
        assert_eq!(ai.responses.len(), 2);
    }
    if let EnhancedChunk::Ai(ref ai) = chunks[2] {
        assert_eq!(ai.responses.len(), 1);
    }
}

#[test]
fn test_event_message_flushes_ai_buffer_mid_sequence() {
    let mut event = make_msg("e1", "system", false, false);
    event.subtype = Some("api_error".to_string());
    event.event_data = Some(SystemEventData {
        subtype: "api_error".to_string(),
        ..Default::default()
    });
    let msgs = vec![
        make_assistant("a1", "2024-01-01T00:00:00Z"),
        make_assistant("a2", "2024-01-01T00:00:01Z"),
        event,
        make_assistant("a3", "2024-01-01T00:00:02Z"),
    ];
    let chunks = build_chunks(&msgs, &[]);
    assert_eq!(chunks.len(), 3);
    assert!(is_ai_chunk(&chunks[0]));
    assert!(is_event_chunk(&chunks[1]));
    assert!(is_ai_chunk(&chunks[2]));
    if let EnhancedChunk::Ai(ref ai) = chunks[0] {
        assert_eq!(ai.responses.len(), 2);
    }
}

#[test]
fn test_compact_message_flushes_ai_buffer_mid_sequence() {
    let mut compact = make_msg("c1", "user", false, false);
    compact.is_compact_summary = Some(true);
    let msgs = vec![
        make_assistant("a1", "2024-01-01T00:00:00Z"),
        compact,
        make_assistant("a2", "2024-01-01T00:00:01Z"),
    ];
    let chunks = build_chunks(&msgs, &[]);
    assert_eq!(chunks.len(), 3);
    assert!(is_ai_chunk(&chunks[0]));
    assert!(is_compact_chunk(&chunks[1]));
    assert!(is_ai_chunk(&chunks[2]));
}
