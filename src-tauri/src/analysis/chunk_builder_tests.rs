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

// build_chunks — basic patterns

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

// AI buffer flushing

#[test]
fn test_multiple_assistants_buffered_into_single_ai_chunk() {
    let msgs = vec![
        make_assistant("a1", "2024-01-01T00:00:00Z"),
        make_assistant("a2", "2024-01-01T00:00:01Z"),
        make_assistant("a3", "2024-01-01T00:00:02Z"),
    ];
    let chunks = build_chunks(&msgs, &[]);
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
    assert!(is_ai_chunk(&chunks[0]));
    assert!(is_user_chunk(&chunks[1]));
    assert!(is_ai_chunk(&chunks[2]));
    if let EnhancedChunk::Ai(ref ai) = chunks[0] {
        assert_eq!(ai.responses.len(), 2);
    }
}

// System / compact / event in sequence

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

#[test]
fn test_event_chunk_in_sequence() {
    let mut event = make_msg("e1", "system", false, false);
    event.subtype = Some("api_error".to_string());
    event.event_data = Some(SystemEventData {
        subtype: "api_error".to_string(),
        ..Default::default()
    });

    let msgs = vec![make_assistant("a1", "2024-01-01T00:00:00Z"), event];
    let chunks = build_chunks(&msgs, &[]);
    assert_eq!(chunks.len(), 2);
    assert!(is_ai_chunk(&chunks[0]));
    assert!(is_event_chunk(&chunks[1]));
}

// Filtering

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
    assert_eq!(chunks.len(), 2);
    assert!(is_user_chunk(&chunks[0]));
    assert!(is_ai_chunk(&chunks[1]));
}

#[test]
fn test_sidechain_messages_filtered_out() {
    let msgs = vec![
        make_msg("u1", "user", false, false),
        make_msg("sc1", "user", false, true),
        make_assistant("a1", "2024-01-01T00:01:00Z"),
    ];
    let chunks = build_chunks(&msgs, &[]);
    assert_eq!(chunks.len(), 2);
}

#[test]
fn test_multiple_sidechain_messages_all_filtered() {
    let msgs = vec![
        make_msg("u1", "user", false, false),
        make_msg("sc1", "user", false, true),
        make_msg("sc2", "user", false, true),
        make_msg("sc3", "user", false, true),
        make_assistant("a1", "2024-01-01T00:01:00Z"),
    ];
    let chunks = build_chunks(&msgs, &[]);
    assert_eq!(chunks.len(), 2);
    assert!(is_user_chunk(&chunks[0]));
    assert!(is_ai_chunk(&chunks[1]));
}

// Progress enrichment

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

#[test]
fn test_isolated_meta_user_does_not_create_user_chunk() {
    let mut meta = make_msg("m1", "user", true, false);
    meta.content = ParsedMessageContent::Blocks(vec![]);
    let chunks = build_chunks(&[meta], &[]);
    assert!(
        chunks.iter().all(|c| !is_user_chunk(c)),
        "isolated meta user produced a UserChunk: {chunks:?}"
    );
}

#[test]
fn test_typical_conversation_pattern() {
    let mut tool_result = make_msg("tr1", "user", true, false);
    tool_result.content = ParsedMessageContent::Blocks(vec![]);

    let msgs = vec![
        make_msg("u1", "user", false, false),
        make_assistant("a1", "2024-01-01T00:00:01Z"),
        tool_result,
        make_assistant("a2", "2024-01-01T00:00:03Z"),
        make_msg("u2", "user", false, false),
        make_assistant("a3", "2024-01-01T00:00:05Z"),
    ];
    let chunks = build_chunks(&msgs, &[]);

    assert_eq!(chunks.len(), 4);
    assert!(is_user_chunk(&chunks[0]));
    assert!(is_ai_chunk(&chunks[1]));
    assert!(is_user_chunk(&chunks[2]));
    assert!(is_ai_chunk(&chunks[3]));
}
