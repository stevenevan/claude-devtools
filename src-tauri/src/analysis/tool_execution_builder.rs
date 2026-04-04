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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::messages::{ParsedMessageContent, ToolCall, ToolResult};

    fn make_assistant(uuid: &str, ts: &str, tool_calls: Vec<ToolCall>) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: "assistant".to_string(),
            timestamp: ts.to_string(),
            role: Some("assistant".to_string()),
            content: ParsedMessageContent::Text("response".to_string()),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
            is_meta: false,
            user_type: None,
            tool_calls,
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

    fn make_tool_result_msg(
        uuid: &str,
        ts: &str,
        source_id: Option<&str>,
        results: Vec<ToolResult>,
    ) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: "user".to_string(),
            timestamp: ts.to_string(),
            role: Some("user".to_string()),
            content: ParsedMessageContent::Text("".to_string()),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
            is_meta: true,
            user_type: None,
            tool_calls: vec![],
            tool_results: results,
            source_tool_use_id: source_id.map(|s| s.to_string()),
            source_tool_assistant_uuid: None,
            tool_use_result: None,
            is_compact_summary: None,
            request_id: None,
            subtype: None,
            event_data: None,
        }
    }

    fn tc(id: &str, name: &str) -> ToolCall {
        ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            input: serde_json::json!({}),
            is_task: false,
            task_description: None,
            task_subagent_type: None,
        }
    }

    fn tr(tool_use_id: &str) -> ToolResult {
        ToolResult {
            tool_use_id: tool_use_id.to_string(),
            content: serde_json::json!("result text"),
            is_error: false,
        }
    }

    #[test]
    fn test_empty_messages() {
        let result = build_tool_executions(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_call_with_result_via_tool_results() {
        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z", vec![tc("tu1", "Read")]),
            make_tool_result_msg("u1", "2024-01-01T00:00:01Z", None, vec![tr("tu1")]),
        ];
        let execs = build_tool_executions(&msgs);
        assert_eq!(execs.len(), 1);
        assert_eq!(execs[0].tool_call.name, "Read");
        assert!(execs[0].result.is_some());
        assert_eq!(execs[0].duration_ms, Some(1000.0));
    }

    #[test]
    fn test_call_with_result_via_source_id() {
        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z", vec![tc("tu1", "Bash")]),
            make_tool_result_msg("u1", "2024-01-01T00:00:02Z", Some("tu1"), vec![tr("tu1")]),
        ];
        let execs = build_tool_executions(&msgs);
        assert_eq!(execs.len(), 1);
        assert_eq!(execs[0].tool_call.name, "Bash");
        assert_eq!(execs[0].duration_ms, Some(2000.0));
    }

    #[test]
    fn test_orphaned_call_without_result() {
        let msgs = vec![make_assistant(
            "a1",
            "2024-01-01T00:00:00Z",
            vec![tc("tu1", "Write")],
        )];
        let execs = build_tool_executions(&msgs);
        assert_eq!(execs.len(), 1);
        assert_eq!(execs[0].tool_call.name, "Write");
        assert!(execs[0].result.is_none());
        assert!(execs[0].end_time.is_none());
        assert!(execs[0].duration_ms.is_none());
    }

    #[test]
    fn test_multiple_calls_with_results() {
        let msgs = vec![
            make_assistant(
                "a1",
                "2024-01-01T00:00:00Z",
                vec![tc("tu1", "Read"), tc("tu2", "Grep")],
            ),
            make_tool_result_msg("u1", "2024-01-01T00:00:01Z", None, vec![tr("tu1"), tr("tu2")]),
        ];
        let execs = build_tool_executions(&msgs);
        assert_eq!(execs.len(), 2);
    }

    #[test]
    fn test_results_sorted_by_start_time() {
        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:02Z", vec![tc("tu2", "Late")]),
            make_assistant("a0", "2024-01-01T00:00:00Z", vec![tc("tu1", "Early")]),
        ];
        let execs = build_tool_executions(&msgs);
        assert_eq!(execs.len(), 2);
        assert_eq!(execs[0].tool_call.name, "Early");
        assert_eq!(execs[1].tool_call.name, "Late");
    }

    #[test]
    fn test_no_duplicate_results() {
        // Both sourceToolUseId and toolResults point to the same call — should not duplicate
        let msgs = vec![
            make_assistant("a1", "2024-01-01T00:00:00Z", vec![tc("tu1", "Edit")]),
            make_tool_result_msg("u1", "2024-01-01T00:00:01Z", Some("tu1"), vec![tr("tu1")]),
        ];
        let execs = build_tool_executions(&msgs);
        assert_eq!(execs.len(), 1);
    }
}
