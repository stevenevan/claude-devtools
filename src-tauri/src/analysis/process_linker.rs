/// Link subagent processes to AI chunks.
/// Two-tier: parentTaskId matching (primary), timing-based (fallback).

use crate::types::chunks::Process;
use crate::types::messages::ParsedMessage;

/// Link processes to an AI chunk and return the linked ones.
pub fn link_processes_to_ai_chunk(
    chunk_responses: &[ParsedMessage],
    chunk_start: &str,
    chunk_end: &str,
    subagents: &[Process],
) -> Vec<Process> {
    // Build set of Task tool IDs from this chunk's responses
    let mut chunk_task_ids = std::collections::HashSet::new();
    for resp in chunk_responses {
        for tc in &resp.tool_calls {
            if tc.is_task {
                chunk_task_ids.insert(tc.id.as_str());
            }
        }
    }

    let mut linked = Vec::new();
    let mut linked_ids = std::collections::HashSet::new();

    // Primary: parentTaskId matching
    for sub in subagents {
        if let Some(ref ptid) = sub.parent_task_id {
            if chunk_task_ids.contains(ptid.as_str()) {
                linked.push(sub.clone());
                linked_ids.insert(sub.id.as_str());
            }
        }
    }

    // Fallback: timing-based for orphaned subagents (no parentTaskId)
    for sub in subagents {
        if linked_ids.contains(sub.id.as_str()) {
            continue;
        }
        if sub.parent_task_id.is_some() {
            continue; // Has parentTaskId but didn't match — belongs to different chunk
        }
        if sub.start_time.as_str() >= chunk_start && sub.start_time.as_str() <= chunk_end {
            linked.push(sub.clone());
        }
    }

    linked.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    linked
}
