use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::chunks::SemanticStep;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultInfo {
    pub content: Value,
    pub is_error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedToolItem {
    pub id: String,
    pub name: String,
    pub input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ToolResultInfo>,
    pub input_preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_preview: Option<String>,
    pub start_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    pub is_orphaned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_instructions_token_count: Option<u64>,
}

/// IPC message representation for extracting skill instructions.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMessageInput {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(default)]
    pub is_meta: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_tool_use_id: Option<String>,
    #[serde(default)]
    pub content: Value,
}

fn estimate_tokens(text: &str) -> u64 {
    if text.is_empty() {
        return 0;
    }
    ((text.len() + 3) / 4) as u64
}

fn truncate(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len])
    }
}

fn format_tool_input(input: &Value) -> String {
    match serde_json::to_string_pretty(input) {
        Ok(json) => truncate(&json, 100),
        Err(_) => "[Invalid JSON]".to_string(),
    }
}

fn format_tool_result(content: &Value) -> String {
    match content {
        Value::String(s) => truncate(s, 200),
        _ => match serde_json::to_string_pretty(content) {
            Ok(json) => truncate(&json, 200),
            Err(_) => "[Invalid result]".to_string(),
        },
    }
}

/// Link tool calls to their results, returning a map of call ID → LinkedToolItem.
pub fn link_tool_calls_to_results(
    steps: &[SemanticStep],
    responses: Option<&[ParsedMessageInput]>,
) -> HashMap<String, LinkedToolItem> {
    let mut linked_tools = HashMap::new();

    // Collect tool_call steps
    let tool_calls: Vec<&SemanticStep> = steps
        .iter()
        .filter(|s| s.step_type == "tool_call")
        .collect();

    // Build result lookup by ID
    let mut result_steps_by_id: HashMap<&str, &SemanticStep> = HashMap::new();
    for step in steps {
        if step.step_type == "tool_result" {
            result_steps_by_id.insert(&step.id, step);
        }
    }

    // Build skill instructions lookup
    let mut skill_instructions_by_id: HashMap<String, String> = HashMap::new();
    if let Some(msgs) = responses {
        for msg in msgs {
            if msg.msg_type == "user"
                && msg.is_meta
                && msg.source_tool_use_id.is_some()
            {
                if let Value::Array(blocks) = &msg.content {
                    for block in blocks {
                        if let (Some("text"), Some(text)) = (
                            block.get("type").and_then(|v| v.as_str()),
                            block.get("text").and_then(|v| v.as_str()),
                        ) {
                            if text.starts_with("Base directory for this skill:") {
                                skill_instructions_by_id.insert(
                                    msg.source_tool_use_id.clone().unwrap(),
                                    text.to_string(),
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    for call_step in tool_calls {
        let tool_call_id = &call_step.id;
        let tool_name = call_step
            .content
            .tool_name
            .as_deref()
            .unwrap_or("Unknown");
        let tool_input = call_step
            .content
            .tool_input
            .clone()
            .unwrap_or(Value::Object(Default::default()));

        let result_step = result_steps_by_id.get(tool_call_id.as_str()).copied();

        let skill_instructions = if tool_name == "Skill" {
            skill_instructions_by_id.get(tool_call_id).cloned()
        } else {
            None
        };

        let call_text = format!("{}{}", tool_name, serde_json::to_string(&tool_input).unwrap_or_default());
        let call_tokens = estimate_tokens(&call_text);

        let result = result_step.map(|rs| {
            let content = rs
                .content
                .tool_result_content
                .as_ref()
                .map(|c| Value::String(c.clone()))
                .unwrap_or(Value::String(String::new()));
            ToolResultInfo {
                content,
                is_error: rs.content.is_error.unwrap_or(false),
                tool_use_result: rs.content.tool_use_result.clone(),
                token_count: rs.content.token_count,
            }
        });

        let output_preview = result_step.map(|rs| {
            let content = rs
                .content
                .tool_result_content
                .as_deref()
                .unwrap_or("");
            format_tool_result(&Value::String(content.to_string()))
        });

        let duration_ms = result_step.and_then(|rs| {
            let start = chrono::DateTime::parse_from_rfc3339(&call_step.start_time).ok()?;
            let end = chrono::DateTime::parse_from_rfc3339(&rs.start_time).ok()?;
            Some((end - start).num_milliseconds() as f64)
        });

        let linked_item = LinkedToolItem {
            id: tool_call_id.clone(),
            name: tool_name.to_string(),
            input: tool_input.clone(),
            call_tokens: Some(call_tokens),
            result,
            input_preview: format_tool_input(&tool_input),
            output_preview,
            start_time: call_step.start_time.clone(),
            end_time: result_step.map(|rs| rs.start_time.clone()),
            duration_ms,
            is_orphaned: result_step.is_none(),
            skill_instructions_token_count: skill_instructions
                .as_ref()
                .map(|s| estimate_tokens(s)),
            skill_instructions,
        };

        linked_tools.insert(tool_call_id.clone(), linked_item);
    }

    linked_tools
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::chunks::{SemanticStep, SemanticStepContent};

    fn make_step(id: &str, step_type: &str, tool_name: Option<&str>) -> SemanticStep {
        SemanticStep {
            id: id.to_string(),
            step_type: step_type.to_string(),
            start_time: "2026-01-01T00:00:00Z".to_string(),
            end_time: Some("2026-01-01T00:00:01Z".to_string()),
            duration_ms: 1000.0,
            content: SemanticStepContent {
                thinking_text: None,
                tool_name: tool_name.map(|s| s.to_string()),
                tool_input: Some(Value::Object(Default::default())),
                tool_result_content: if step_type == "tool_result" {
                    Some("result text".to_string())
                } else {
                    None
                },
                is_error: None,
                tool_use_result: None,
                token_count: Some(10),
                subagent_id: None,
                subagent_description: None,
                output_text: None,
                source_model: None,
                interruption_text: None,
            },
            tokens: None,
            is_parallel: None,
            group_id: None,
            context: "main".to_string(),
            agent_id: None,
            source_message_id: None,
            effective_end_time: None,
            effective_duration_ms: None,
            is_gap_filled: None,
            context_tokens: None,
            accumulated_context: None,
            token_breakdown: None,
        }
    }

    #[test]
    fn empty_steps_returns_empty() {
        let result = link_tool_calls_to_results(&[], None);
        assert!(result.is_empty());
    }

    #[test]
    fn links_call_to_result() {
        let steps = vec![
            make_step("tc-1", "tool_call", Some("Read")),
            make_step("tc-1", "tool_result", Some("Read")),
        ];
        let result = link_tool_calls_to_results(&steps, None);
        assert_eq!(result.len(), 1);
        let item = result.get("tc-1").unwrap();
        assert_eq!(item.name, "Read");
        assert!(!item.is_orphaned);
        assert!(item.result.is_some());
    }

    #[test]
    fn orphaned_call_without_result() {
        let steps = vec![make_step("tc-2", "tool_call", Some("Write"))];
        let result = link_tool_calls_to_results(&steps, None);
        assert_eq!(result.len(), 1);
        let item = result.get("tc-2").unwrap();
        assert!(item.is_orphaned);
        assert!(item.result.is_none());
    }

    #[test]
    fn multiple_calls_linked_correctly() {
        let steps = vec![
            make_step("a", "tool_call", Some("Read")),
            make_step("b", "tool_call", Some("Write")),
            make_step("a", "tool_result", Some("Read")),
            make_step("b", "tool_result", Some("Write")),
        ];
        let result = link_tool_calls_to_results(&steps, None);
        assert_eq!(result.len(), 2);
        assert!(!result.get("a").unwrap().is_orphaned);
        assert!(!result.get("b").unwrap().is_orphaned);
    }

    #[test]
    fn extracts_skill_instructions() {
        let steps = vec![
            make_step("skill-1", "tool_call", Some("Skill")),
            make_step("skill-1", "tool_result", Some("Skill")),
        ];
        let responses = vec![ParsedMessageInput {
            msg_type: "user".to_string(),
            is_meta: true,
            source_tool_use_id: Some("skill-1".to_string()),
            content: Value::Array(vec![serde_json::json!({
                "type": "text",
                "text": "Base directory for this skill: /Users/test/project"
            })]),
        }];
        let result = link_tool_calls_to_results(&steps, Some(&responses));
        let item = result.get("skill-1").unwrap();
        assert!(item.skill_instructions.is_some());
        assert!(item.skill_instructions_token_count.is_some());
    }

    #[test]
    fn call_tokens_computed_from_name_and_input() {
        let steps = vec![make_step("tc-3", "tool_call", Some("Read"))];
        let result = link_tool_calls_to_results(&steps, None);
        let item = result.get("tc-3").unwrap();
        assert!(item.call_tokens.unwrap() > 0);
    }

    #[test]
    fn error_result_detected() {
        let mut steps = vec![
            make_step("err-1", "tool_call", Some("Bash")),
            make_step("err-1", "tool_result", Some("Bash")),
        ];
        steps[1].content.is_error = Some(true);
        let result = link_tool_calls_to_results(&steps, None);
        let item = result.get("err-1").unwrap();
        assert!(item.result.as_ref().unwrap().is_error);
    }
}
