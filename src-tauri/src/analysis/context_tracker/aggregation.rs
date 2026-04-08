use std::collections::HashSet;

use super::injections::*;
use crate::analysis::tool_linking::LinkedToolItem;

/// Tool names that constitute task coordination overhead.
static TASK_COORDINATION_TOOL_NAMES: &[&str] = &[
    "SendMessage",
    "TeamCreate",
    "TeamDelete",
    "TaskCreate",
    "TaskUpdate",
    "TaskList",
    "TaskGet",
];

fn is_task_coordination_tool(name: &str) -> bool {
    TASK_COORDINATION_TOOL_NAMES.contains(&name)
}

fn estimate_tokens(text: &str) -> u64 {
    if text.is_empty() {
        return 0;
    }
    ((text.len() + 3) / 4) as u64
}

/// Aggregate tool output tokens from linked tools (excluding task coordination tools).
pub fn aggregate_tool_outputs(
    linked_tools: &std::collections::HashMap<String, LinkedToolItem>,
    turn_index: u32,
    ai_group_id: &str,
) -> Option<ToolOutputInjection> {
    let mut breakdown = Vec::new();
    let mut total_tokens: u64 = 0;

    for linked_tool in linked_tools.values() {
        if is_task_coordination_tool(&linked_tool.name) {
            continue;
        }

        let call_tokens = linked_tool.call_tokens.unwrap_or(0);
        let result_tokens = linked_tool
            .result
            .as_ref()
            .and_then(|r| r.token_count)
            .unwrap_or(0);
        let skill_tokens = linked_tool.skill_instructions_token_count.unwrap_or(0);
        let tool_token_count = call_tokens + result_tokens + skill_tokens;

        if tool_token_count > 0 {
            let display_name = if linked_tool.name == "Task" {
                "Task (Subagent)".to_string()
            } else {
                linked_tool.name.clone()
            };
            breakdown.push(ToolTokenBreakdown {
                tool_name: display_name,
                token_count: tool_token_count,
                is_error: linked_tool
                    .result
                    .as_ref()
                    .map(|r| r.is_error)
                    .unwrap_or(false),
                tool_use_id: Some(linked_tool.id.clone()),
            });
            total_tokens += tool_token_count;
        }
    }

    if total_tokens == 0 {
        return None;
    }

    Some(ToolOutputInjection {
        id: generate_tool_output_id(turn_index),
        turn_index,
        ai_group_id: ai_group_id.to_string(),
        estimated_tokens: total_tokens,
        tool_count: breakdown.len() as u32,
        tool_breakdown: breakdown,
    })
}

/// Aggregate task coordination tokens from linked tools.
pub fn aggregate_task_coordination(
    linked_tools: &std::collections::HashMap<String, LinkedToolItem>,
    turn_index: u32,
    ai_group_id: &str,
) -> Option<TaskCoordinationInjection> {
    let mut breakdown = Vec::new();
    let mut total_tokens: u64 = 0;

    for linked_tool in linked_tools.values() {
        if !is_task_coordination_tool(&linked_tool.name) {
            continue;
        }

        let call_tokens = linked_tool.call_tokens.unwrap_or(0);
        let result_tokens = linked_tool
            .result
            .as_ref()
            .and_then(|r| r.token_count)
            .unwrap_or(0);
        let skill_tokens = linked_tool.skill_instructions_token_count.unwrap_or(0);
        let tool_token_count = call_tokens + result_tokens + skill_tokens;

        if tool_token_count > 0 {
            let mut label = linked_tool.name.clone();
            if linked_tool.name == "SendMessage" {
                if let Some(recipient) = linked_tool.input.get("recipient").and_then(|v| v.as_str())
                {
                    label = format!("SendMessage → {}", recipient);
                }
            }

            let item_type = if linked_tool.name == "SendMessage" {
                "send-message"
            } else {
                "task-tool"
            };

            breakdown.push(TaskCoordinationBreakdown {
                item_type: item_type.to_string(),
                tool_name: Some(linked_tool.name.clone()),
                token_count: tool_token_count,
                label,
            });
            total_tokens += tool_token_count;
        }
    }

    if total_tokens == 0 {
        return None;
    }

    Some(TaskCoordinationInjection {
        id: generate_task_coordination_id(turn_index),
        turn_index,
        ai_group_id: ai_group_id.to_string(),
        estimated_tokens: total_tokens,
        breakdown,
    })
}

/// Create a user message injection from raw text.
pub fn create_user_message_injection(
    text: &str,
    turn_index: u32,
    ai_group_id: &str,
) -> Option<UserMessageInjection> {
    if text.is_empty() {
        return None;
    }

    let tokens = estimate_tokens(text);
    if tokens == 0 {
        return None;
    }

    let text_preview = if text.len() > 80 {
        format!("{}…", &text[..80])
    } else {
        text.to_string()
    };

    Some(UserMessageInjection {
        id: generate_user_message_id(turn_index),
        turn_index,
        ai_group_id: ai_group_id.to_string(),
        estimated_tokens: tokens,
        text_preview,
    })
}

/// Accumulate injections and compute token totals by category.
pub fn compute_category_totals(
    accumulated: &[ContextInjection],
    new_injections: &[ContextInjection],
) -> (TokensByCategory, NewCountsByCategory) {
    let mut tokens = TokensByCategory::default();
    let mut counts = NewCountsByCategory::default();

    // Count new injections by category
    for injection in new_injections {
        match injection {
            ContextInjection::ClaudeMd(_) => counts.claude_md += 1,
            ContextInjection::MentionedFile(_) => counts.mentioned_files += 1,
            ContextInjection::ToolOutput(t) => counts.tool_outputs += t.tool_count,
            ContextInjection::ThinkingText(_) => counts.thinking_text += 1,
            ContextInjection::TaskCoordination(t) => {
                counts.task_coordination += t.breakdown.len() as u32
            }
            ContextInjection::UserMessage(_) => counts.user_messages += 1,
        }
    }

    // Sum tokens from all accumulated + new injections
    for injection in accumulated.iter().chain(new_injections.iter()) {
        let est = injection.estimated_tokens();
        match injection {
            ContextInjection::ClaudeMd(_) => tokens.claude_md += est,
            ContextInjection::MentionedFile(_) => tokens.mentioned_files += est,
            ContextInjection::ToolOutput(_) => tokens.tool_outputs += est,
            ContextInjection::ThinkingText(_) => tokens.thinking_text += est,
            ContextInjection::TaskCoordination(_) => tokens.task_coordination += est,
            ContextInjection::UserMessage(_) => tokens.user_messages += est,
        }
    }

    (tokens, counts)
}

/// Collect all paths from accumulated injections that have a path field.
pub fn collect_previous_paths(injections: &[ContextInjection]) -> HashSet<String> {
    injections
        .iter()
        .filter_map(|inj| inj.path().map(|p| p.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::tool_linking::{LinkedToolItem, ToolResultInfo};
    use serde_json::Value;
    use std::collections::HashMap;

    fn make_linked_tool(name: &str, call_tokens: u64, result_tokens: u64) -> LinkedToolItem {
        LinkedToolItem {
            id: format!("tc-{}", name),
            name: name.to_string(),
            input: Value::Object(Default::default()),
            call_tokens: Some(call_tokens),
            result: Some(ToolResultInfo {
                content: Value::String("ok".to_string()),
                is_error: false,
                tool_use_result: None,
                token_count: Some(result_tokens),
            }),
            input_preview: "{}".to_string(),
            output_preview: Some("ok".to_string()),
            start_time: "2026-01-01T00:00:00Z".to_string(),
            end_time: Some("2026-01-01T00:00:01Z".to_string()),
            duration_ms: Some(1000.0),
            is_orphaned: false,
            skill_instructions: None,
            skill_instructions_token_count: None,
        }
    }

    #[test]
    fn aggregate_tool_outputs_skips_task_coordination() {
        let mut tools = HashMap::new();
        tools.insert("a".to_string(), make_linked_tool("Read", 10, 20));
        tools.insert("b".to_string(), make_linked_tool("SendMessage", 50, 30));

        let result = aggregate_tool_outputs(&tools, 0, "ai-0");
        let inj = result.unwrap();
        // Only Read should be counted
        assert_eq!(inj.tool_count, 1);
        assert_eq!(inj.estimated_tokens, 30); // 10 + 20
    }

    #[test]
    fn aggregate_task_coordination_only_task_tools() {
        let mut tools = HashMap::new();
        tools.insert("a".to_string(), make_linked_tool("Read", 10, 20));
        tools.insert("b".to_string(), make_linked_tool("SendMessage", 50, 30));

        let result = aggregate_task_coordination(&tools, 0, "ai-0");
        let inj = result.unwrap();
        assert_eq!(inj.breakdown.len(), 1);
        assert_eq!(inj.estimated_tokens, 80); // 50 + 30
    }

    #[test]
    fn aggregate_tool_outputs_returns_none_when_empty() {
        let tools = HashMap::new();
        assert!(aggregate_tool_outputs(&tools, 0, "ai-0").is_none());
    }

    #[test]
    fn create_user_message_empty_returns_none() {
        assert!(create_user_message_injection("", 0, "ai-0").is_none());
    }

    #[test]
    fn create_user_message_truncates_preview() {
        let long_text = "a".repeat(200);
        let inj = create_user_message_injection(&long_text, 0, "ai-0").unwrap();
        assert!(inj.text_preview.len() <= 84); // 80 + "…" (3 bytes)
    }

    #[test]
    fn compute_category_totals_sums_correctly() {
        let accumulated = vec![ContextInjection::UserMessage(UserMessageInjection {
            id: "u1".to_string(),
            turn_index: 0,
            ai_group_id: "ai-0".to_string(),
            estimated_tokens: 100,
            text_preview: "hello".to_string(),
        })];
        let new_injs = vec![ContextInjection::UserMessage(UserMessageInjection {
            id: "u2".to_string(),
            turn_index: 1,
            ai_group_id: "ai-1".to_string(),
            estimated_tokens: 50,
            text_preview: "world".to_string(),
        })];

        let (tokens, counts) = compute_category_totals(&accumulated, &new_injs);
        assert_eq!(tokens.user_messages, 150);
        assert_eq!(counts.user_messages, 1);
    }
}
