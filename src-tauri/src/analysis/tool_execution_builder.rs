/// Build tool execution tracking from messages.
/// Matches tool calls with their results using sourceToolUseID and toolResults.

use std::collections::HashMap;

use crate::types::chunks::ToolExecution;
use crate::types::messages::ParsedMessage;

pub fn build_tool_executions(messages: &[ParsedMessage]) -> Vec<ToolExecution> {
    let mut executions: Vec<ToolExecution> = vec![];

    // First pass: collect all tool calls
    let mut call_map: HashMap<String, (crate::types::messages::ToolCall, String)> = HashMap::new();
    for msg in messages {
        for tc in &msg.tool_calls {
            call_map.insert(tc.id.clone(), (tc.clone(), msg.timestamp.clone()));
        }
    }

    // Second pass: match results
    for msg in messages {
        // Match via sourceToolUseID
        if let Some(ref source_id) = msg.source_tool_use_id {
            if let Some((call, start_time)) = call_map.get(source_id) {
                if let Some(result) = msg.tool_results.first() {
                    executions.push(ToolExecution {
                        tool_call: call.clone(),
                        result: Some(result.clone()),
                        start_time: start_time.clone(),
                        end_time: Some(msg.timestamp.clone()),
                        duration_ms: Some(timestamp_diff_ms(&msg.timestamp, start_time)),
                    });
                }
            }
        }

        // Match via toolResults array
        for result in &msg.tool_results {
            let already = executions
                .iter()
                .any(|e| e.result.as_ref().is_some_and(|r| r.tool_use_id == result.tool_use_id));
            if already {
                continue;
            }

            if let Some((call, start_time)) = call_map.get(&result.tool_use_id) {
                executions.push(ToolExecution {
                    tool_call: call.clone(),
                    result: Some(result.clone()),
                    start_time: start_time.clone(),
                    end_time: Some(msg.timestamp.clone()),
                    duration_ms: Some(timestamp_diff_ms(&msg.timestamp, start_time)),
                });
            }
        }
    }

    // Add orphaned calls (no result)
    for (id, (call, start_time)) in &call_map {
        if !executions.iter().any(|e| &e.tool_call.id == id) {
            executions.push(ToolExecution {
                tool_call: call.clone(),
                result: None,
                start_time: start_time.clone(),
                end_time: None,
                duration_ms: None,
            });
        }
    }

    executions.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    executions
}

fn timestamp_diff_ms(a: &str, b: &str) -> f64 {
    let parse = |s: &str| -> f64 {
        chrono::DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.timestamp_millis() as f64)
            .unwrap_or(0.0)
    };
    (parse(a) - parse(b)).max(0.0)
}
