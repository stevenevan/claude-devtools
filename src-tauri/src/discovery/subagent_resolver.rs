/// Subagent resolution: parse subagent JSONL files, link to Task calls,
/// detect parallelism, and propagate team metadata.

use std::collections::HashSet;
use std::path::Path;

use crate::parsing::{metrics::calculate_metrics, session_parser};
use crate::types::chunks::Process;
use crate::types::messages::{ParsedMessage, ToolCall};

const PARALLEL_WINDOW_MS: f64 = 100.0;

/// Resolve all subagents for a session.
pub fn resolve_subagents(
    projects_dir: &Path,
    project_id: &str,
    session_id: &str,
    task_calls: &[ToolCall],
    messages: &[ParsedMessage],
) -> Vec<Process> {
    let files = list_subagent_files(projects_dir, project_id, session_id);
    if files.is_empty() {
        return vec![];
    }

    let mut subagents: Vec<Process> = files
        .iter()
        .filter_map(|path| parse_subagent_file(path))
        .collect();

    link_to_task_calls(&mut subagents, task_calls, messages);
    detect_parallel_execution(&mut subagents);

    subagents.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    subagents
}

/// List all subagent JSONL files for a session.
fn list_subagent_files(
    projects_dir: &Path,
    project_id: &str,
    session_id: &str,
) -> Vec<std::path::PathBuf> {
    let base_dir = super::path_decoder::extract_base_dir(project_id);
    let mut files = vec![];

    // New structure: {projectId}/{sessionId}/subagents/*.jsonl
    let new_path = projects_dir.join(&base_dir).join(session_id).join("subagents");
    if new_path.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&new_path) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.ends_with(".jsonl") {
                    files.push(entry.path());
                }
            }
        }
    }

    // Old structure: {projectId}/agent_*.jsonl (only if no new structure files found)
    if files.is_empty() {
        let project_dir = projects_dir.join(&base_dir);
        if let Ok(entries) = std::fs::read_dir(&project_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("agent_") && name_str.ends_with(".jsonl") {
                    files.push(entry.path());
                }
            }
        }
    }

    files
}

/// Parse a single subagent JSONL file into a Process.
fn parse_subagent_file(file_path: &Path) -> Option<Process> {
    let (messages, _) = session_parser::parse_jsonl_file(file_path).ok()?;
    if messages.is_empty() {
        return None;
    }

    // Filter warmup subagents
    if is_warmup_subagent(&messages) {
        return None;
    }

    // Extract agent ID from filename (e.g., "agent-abc123.jsonl" -> "abc123")
    let id = extract_agent_id(file_path);

    let (start_time, end_time, duration_ms) = calculate_timing(&messages);
    let metrics = calculate_metrics(&messages);

    Some(Process {
        id,
        file_path: file_path.to_string_lossy().to_string(),
        start_time,
        end_time,
        duration_ms,
        metrics,
        messages,
        description: None,
        subagent_type: None,
        is_parallel: false,
        parent_task_id: None,
        is_ongoing: None,
        main_session_impact: None,
        team: None,
    })
}

/// Extract agent ID from file path.
fn extract_agent_id(file_path: &Path) -> String {
    let stem = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    // "agent-abc123" -> "abc123", "agent_abc123" -> "abc123"
    if let Some(rest) = stem.strip_prefix("agent-").or_else(|| stem.strip_prefix("agent_")) {
        rest.to_string()
    } else {
        stem
    }
}

/// Check if this is a warmup subagent (first user message is "Warmup").
fn is_warmup_subagent(messages: &[ParsedMessage]) -> bool {
    messages.iter().any(|m| {
        m.message_type == "user"
            && !m.is_meta
            && matches!(&m.content, crate::types::messages::ParsedMessageContent::Text(t) if t.trim() == "Warmup")
    })
}

/// Calculate start/end/duration from messages.
fn calculate_timing(messages: &[ParsedMessage]) -> (String, String, f64) {
    let start = &messages[0].timestamp;
    let end = messages
        .iter()
        .map(|m| &m.timestamp)
        .max()
        .unwrap_or(start);

    let duration_ms = timestamp_diff_ms(end, start);
    (start.clone(), end.clone(), duration_ms)
}

/// Link subagents to Task calls.
fn link_to_task_calls(
    subagents: &mut [Process],
    task_calls: &[ToolCall],
    messages: &[ParsedMessage],
) {
    if task_calls.is_empty() {
        return;
    }

    // Phase 1: Match via toolUseResult.agentId in messages
    for msg in messages {
        if let Some(ref tool_use_result) = msg.tool_use_result {
            if let Some(agent_id) = tool_use_result.get("agentId").and_then(|v| v.as_str()) {
                if let Some(ref source_id) = msg.source_tool_use_id {
                    if let Some(sub) = subagents.iter_mut().find(|s| s.id == agent_id) {
                        sub.parent_task_id = Some(source_id.clone());
                        // Enrich from matching Task call
                        if let Some(tc) = task_calls.iter().find(|t| &t.id == source_id) {
                            enrich_from_task_call(sub, tc);
                        }
                    }
                }
            }
        }
    }

    // Phase 2: Positional fallback for unlinked subagents
    let linked_ids: HashSet<&str> = subagents
        .iter()
        .filter(|s| s.parent_task_id.is_some())
        .map(|s| s.id.as_str())
        .collect();

    let unmatched_tasks: Vec<&ToolCall> = task_calls
        .iter()
        .filter(|tc| !subagents.iter().any(|s| s.parent_task_id.as_deref() == Some(&tc.id)))
        .collect();

    let unlinked: Vec<usize> = subagents
        .iter()
        .enumerate()
        .filter(|(_, s)| !linked_ids.contains(s.id.as_str()))
        .map(|(i, _)| i)
        .collect();

    for (i, task) in unlinked.iter().zip(unmatched_tasks.iter()) {
        subagents[*i].parent_task_id = Some(task.id.clone());
        enrich_from_task_call(&mut subagents[*i], task);
    }
}

/// Enrich a subagent Process from its parent Task call.
fn enrich_from_task_call(process: &mut Process, task_call: &ToolCall) {
    process.description = task_call.task_description.clone();
    process.subagent_type = task_call.task_subagent_type.clone();
}

/// Detect parallel execution (subagents starting within PARALLEL_WINDOW_MS of each other).
fn detect_parallel_execution(subagents: &mut [Process]) {
    if subagents.len() < 2 {
        return;
    }

    let starts: Vec<String> = subagents.iter().map(|s| s.start_time.clone()).collect();

    for i in 0..subagents.len() {
        for j in 0..subagents.len() {
            if i == j {
                continue;
            }
            let diff = timestamp_diff_ms(&starts[i], &starts[j]).abs();
            if diff < PARALLEL_WINDOW_MS {
                subagents[i].is_parallel = true;
                break;
            }
        }
    }
}

/// Calculate millisecond difference between two ISO-8601 timestamps.
fn timestamp_diff_ms(a: &str, b: &str) -> f64 {
    let parse = |s: &str| -> f64 {
        chrono::DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.timestamp_millis() as f64)
            .unwrap_or(0.0)
    };
    parse(a) - parse(b)
}
