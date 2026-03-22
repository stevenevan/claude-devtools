/// Create individual chunk objects from messages.

use crate::parsing::metrics::calculate_metrics;
use crate::types::chunks::{
    EnhancedAIChunk, EnhancedChunk, EnhancedCompactChunk, EnhancedSystemChunk, EnhancedUserChunk,
    Process,
};
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

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

pub fn build_ai_chunk_from_buffer(
    responses: &[ParsedMessage],
    subagents: &[Process],
    all_messages: &[ParsedMessage],
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
