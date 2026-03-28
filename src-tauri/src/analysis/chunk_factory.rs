/// Create individual chunk objects from messages.

use crate::parsing::metrics::calculate_metrics;
use crate::types::chunks::{
    EnhancedAIChunk, EnhancedChunk, EnhancedCompactChunk, EnhancedEventChunk,
    EnhancedSystemChunk, EnhancedUserChunk, Process,
};
use crate::types::messages::{ParsedMessage, ParsedMessageContent, SystemEventData};

use super::context_accumulator::calculate_step_context;
use super::process_linker::link_processes_to_ai_chunk;
use super::semantic_step_extractor::extract_semantic_steps;
use super::semantic_step_grouper::build_semantic_step_groups;
use super::timeline_gap_filling::fill_timeline_gaps;
use super::tool_execution_builder::build_tool_executions;

pub fn build_user_chunk(message: &ParsedMessage) -> EnhancedChunk {
    let id = format!("user-{}", message.uuid);
    let metrics = calculate_metrics(std::slice::from_ref(message));

    EnhancedChunk::User(EnhancedUserChunk {
        id,
        start_time: message.timestamp.clone(),
        end_time: message.timestamp.clone(),
        duration_ms: 0.0,
        metrics,
        user_message: message.clone(),
        raw_messages: vec![message.clone()],
    })
}

pub fn build_system_chunk(message: &ParsedMessage) -> EnhancedChunk {
    let id = format!("system-{}", message.uuid);
    let command_output = extract_command_output(message);
    let metrics = calculate_metrics(std::slice::from_ref(message));

    EnhancedChunk::System(EnhancedSystemChunk {
        id,
        start_time: message.timestamp.clone(),
        end_time: message.timestamp.clone(),
        duration_ms: 0.0,
        metrics,
        message: message.clone(),
        command_output,
        raw_messages: vec![message.clone()],
    })
}

pub fn build_compact_chunk(message: &ParsedMessage) -> EnhancedChunk {
    let id = format!("compact-{}", message.uuid);
    let metrics = calculate_metrics(std::slice::from_ref(message));

    EnhancedChunk::Compact(EnhancedCompactChunk {
        id,
        start_time: message.timestamp.clone(),
        end_time: message.timestamp.clone(),
        duration_ms: 0.0,
        metrics,
        message: message.clone(),
        raw_messages: vec![message.clone()],
    })
}

pub fn build_event_chunk(message: &ParsedMessage) -> EnhancedChunk {
    let id = format!("event-{}", message.uuid);
    let metrics = calculate_metrics(std::slice::from_ref(message));
    let event_data = message.event_data.clone().unwrap_or_else(|| SystemEventData {
        subtype: message.subtype.clone().unwrap_or_default(),
        ..Default::default()
    });

    EnhancedChunk::Event(EnhancedEventChunk {
        id,
        start_time: message.timestamp.clone(),
        end_time: message.timestamp.clone(),
        duration_ms: 0.0,
        metrics,
        message: message.clone(),
        event_data,
        raw_messages: vec![message.clone()],
    })
}

pub fn build_ai_chunk_from_buffer(
    responses: &[ParsedMessage],
    subagents: &[Process],
    all_messages: &[ParsedMessage],
    progress_count: Option<u32>,
    progress_texts: Option<Vec<String>>,
) -> EnhancedChunk {
    let id = if let Some(first) = responses.first() {
        format!("ai-{}", first.uuid)
    } else {
        format!("ai-empty-{}", chrono::Utc::now().timestamp_millis())
    };

    let (start_time, end_time, duration_ms) = calculate_ai_timing(responses);
    let metrics = calculate_metrics(responses);
    let tool_executions = build_tool_executions(responses);
    let sidechain_messages = collect_sidechain_messages(all_messages, &start_time, &end_time);
    let processes = link_processes_to_ai_chunk(responses, &start_time, &end_time, subagents);

    let mut semantic_steps = extract_semantic_steps(responses, &processes);
    fill_timeline_gaps(&mut semantic_steps, &end_time);
    calculate_step_context(&mut semantic_steps, responses);
    let semantic_step_groups = build_semantic_step_groups(&semantic_steps);

    EnhancedChunk::Ai(EnhancedAIChunk {
        id,
        start_time,
        end_time,
        duration_ms,
        metrics,
        responses: responses.to_vec(),
        processes,
        sidechain_messages,
        tool_executions,
        semantic_steps,
        semantic_step_groups: Some(semantic_step_groups),
        raw_messages: responses.to_vec(),
        progress_count,
        progress_texts,
    })
}

fn calculate_ai_timing(responses: &[ParsedMessage]) -> (String, String, f64) {
    if responses.is_empty() {
        let now = chrono::Utc::now().to_rfc3339();
        return (now.clone(), now, 0.0);
    }

    let start = &responses[0].timestamp;
    let end = responses
        .iter()
        .map(|r| &r.timestamp)
        .max()
        .unwrap_or(start);

    let duration_ms = timestamp_diff_ms(end, start).max(0.0);
    (start.clone(), end.clone(), duration_ms)
}

fn collect_sidechain_messages(
    messages: &[ParsedMessage],
    start_time: &str,
    end_time: &str,
) -> Vec<ParsedMessage> {
    messages
        .iter()
        .filter(|m| m.is_sidechain && m.timestamp.as_str() >= start_time && m.timestamp.as_str() < end_time)
        .cloned()
        .collect()
}

fn extract_command_output(message: &ParsedMessage) -> String {
    let content = match &message.content {
        ParsedMessageContent::Text(t) => t.as_str(),
        ParsedMessageContent::Blocks(_) => "",
    };

    static STDOUT_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"<local-command-stdout>([\s\S]*?)</local-command-stdout>").unwrap()
    });
    static STDERR_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"<local-command-stderr>([\s\S]*?)</local-command-stderr>").unwrap()
    });

    if let Some(caps) = STDOUT_RE.captures(content) {
        return caps[1].to_string();
    }
    if let Some(caps) = STDERR_RE.captures(content) {
        return caps[1].to_string();
    }
    content.to_string()
}

fn timestamp_diff_ms(a: &str, b: &str) -> f64 {
    let parse = |s: &str| -> f64 {
        chrono::DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.timestamp_millis() as f64)
            .unwrap_or(0.0)
    };
    parse(a) - parse(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::messages::TokenUsage;

    fn make_user(uuid: &str, ts: &str) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: "user".to_string(),
            timestamp: ts.to_string(),
            role: Some("user".to_string()),
            content: ParsedMessageContent::Text("user input".to_string()),
            usage: None,
            model: None,
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

    // =========================================================================
    // build_user_chunk
    // =========================================================================

    #[test]
    fn test_build_user_chunk_id() {
        let msg = make_user("u1", "2024-01-01T00:00:00Z");
        let chunk = build_user_chunk(&msg);
        if let EnhancedChunk::User(ref c) = chunk {
            assert_eq!(c.id, "user-u1");
            assert_eq!(c.raw_messages.len(), 1);
            assert_eq!(c.start_time, "2024-01-01T00:00:00Z");
            assert_eq!(c.end_time, "2024-01-01T00:00:00Z");
            assert_eq!(c.duration_ms, 0.0);
        } else {
            panic!("expected User chunk");
        }
    }

    // =========================================================================
    // build_system_chunk
    // =========================================================================

    #[test]
    fn test_build_system_chunk_extracts_stdout() {
        let mut msg = make_user("s1", "2024-01-01T00:00:00Z");
        msg.content = ParsedMessageContent::Text(
            "<local-command-stdout>hello world</local-command-stdout>".to_string(),
        );
        let chunk = build_system_chunk(&msg);
        if let EnhancedChunk::System(ref c) = chunk {
            assert_eq!(c.id, "system-s1");
            assert_eq!(c.command_output, "hello world");
        } else {
            panic!("expected System chunk");
        }
    }

    #[test]
    fn test_build_system_chunk_extracts_stderr() {
        let mut msg = make_user("s2", "2024-01-01T00:00:00Z");
        msg.content = ParsedMessageContent::Text(
            "<local-command-stderr>error output</local-command-stderr>".to_string(),
        );
        let chunk = build_system_chunk(&msg);
        if let EnhancedChunk::System(ref c) = chunk {
            assert_eq!(c.command_output, "error output");
        } else {
            panic!("expected System chunk");
        }
    }

    // =========================================================================
    // build_compact_chunk
    // =========================================================================

    #[test]
    fn test_build_compact_chunk() {
        let mut msg = make_user("c1", "2024-01-01T00:00:00Z");
        msg.is_compact_summary = Some(true);
        let chunk = build_compact_chunk(&msg);
        if let EnhancedChunk::Compact(ref c) = chunk {
            assert_eq!(c.id, "compact-c1");
            assert_eq!(c.raw_messages.len(), 1);
        } else {
            panic!("expected Compact chunk");
        }
    }

    // =========================================================================
    // build_event_chunk
    // =========================================================================

    #[test]
    fn test_build_event_chunk_with_event_data() {
        let mut msg = make_user("e1", "2024-01-01T00:00:00Z");
        msg.message_type = "system".to_string();
        msg.subtype = Some("api_error".to_string());
        msg.event_data = Some(SystemEventData {
            subtype: "api_error".to_string(),
            error_status: Some(529),
            ..Default::default()
        });

        let chunk = build_event_chunk(&msg);
        if let EnhancedChunk::Event(ref c) = chunk {
            assert_eq!(c.id, "event-e1");
            assert_eq!(c.event_data.subtype, "api_error");
            assert_eq!(c.event_data.error_status, Some(529));
        } else {
            panic!("expected Event chunk");
        }
    }

    #[test]
    fn test_build_event_chunk_fallback_event_data() {
        let mut msg = make_user("e2", "2024-01-01T00:00:00Z");
        msg.message_type = "system".to_string();
        msg.subtype = Some("turn_duration".to_string());
        // No event_data field — should fall back to default with subtype

        let chunk = build_event_chunk(&msg);
        if let EnhancedChunk::Event(ref c) = chunk {
            assert_eq!(c.event_data.subtype, "turn_duration");
        } else {
            panic!("expected Event chunk");
        }
    }

    // =========================================================================
    // build_ai_chunk_from_buffer
    // =========================================================================

    #[test]
    fn test_build_ai_chunk_single_response() {
        let responses = vec![make_assistant("a1", "2024-01-01T00:00:00Z")];
        let chunk = build_ai_chunk_from_buffer(&responses, &[], &responses, None, None);
        if let EnhancedChunk::Ai(ref c) = chunk {
            assert_eq!(c.id, "ai-a1");
            assert_eq!(c.responses.len(), 1);
            assert_eq!(c.metrics.input_tokens, 100);
            assert_eq!(c.metrics.output_tokens, 50);
            assert!(c.progress_count.is_none());
        } else {
            panic!("expected AI chunk");
        }
    }

    #[test]
    fn test_build_ai_chunk_multiple_responses_timing() {
        let responses = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z"),
            make_assistant("a2", "2024-01-01T00:01:00Z"),
        ];
        let chunk = build_ai_chunk_from_buffer(&responses, &[], &responses, None, None);
        if let EnhancedChunk::Ai(ref c) = chunk {
            assert_eq!(c.start_time, "2024-01-01T00:00:00Z");
            assert_eq!(c.end_time, "2024-01-01T00:01:00Z");
            assert_eq!(c.duration_ms, 60000.0);
            assert_eq!(c.responses.len(), 2);
        } else {
            panic!("expected AI chunk");
        }
    }

    #[test]
    fn test_build_ai_chunk_with_progress() {
        let responses = vec![make_assistant("a1", "2024-01-01T00:00:00Z")];
        let progress_texts = vec!["Step 1".to_string(), "Step 2".to_string()];
        let chunk =
            build_ai_chunk_from_buffer(&responses, &[], &responses, Some(2), Some(progress_texts));
        if let EnhancedChunk::Ai(ref c) = chunk {
            assert_eq!(c.progress_count, Some(2));
            assert_eq!(c.progress_texts.as_ref().unwrap().len(), 2);
        } else {
            panic!("expected AI chunk");
        }
    }

    // =========================================================================
    // timestamp_diff_ms
    // =========================================================================

    #[test]
    fn test_timestamp_diff_ms_positive() {
        let diff = timestamp_diff_ms("2024-01-01T00:01:00Z", "2024-01-01T00:00:00Z");
        assert_eq!(diff, 60000.0);
    }

    #[test]
    fn test_timestamp_diff_ms_same() {
        let diff = timestamp_diff_ms("2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");
        assert_eq!(diff, 0.0);
    }

    #[test]
    fn test_timestamp_diff_ms_invalid() {
        let diff = timestamp_diff_ms("not-a-date", "2024-01-01T00:00:00Z");
        // invalid parses to 0.0
        assert!(diff <= 0.0);
    }
}
