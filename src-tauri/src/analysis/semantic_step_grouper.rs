/// Group semantic steps by source message for collapsible UI.

use std::collections::BTreeMap;

use crate::types::chunks::{SemanticStep, SemanticStepGroup};

pub fn build_semantic_step_groups(steps: &[SemanticStep]) -> Vec<SemanticStepGroup> {
    // Group steps: key is sourceMessageId or None for standalone
    let mut groups_map: BTreeMap<Option<String>, Vec<SemanticStep>> = BTreeMap::new();

    // Preserve insertion order by using a Vec of keys
    let mut key_order: Vec<Option<String>> = Vec::new();

    for step in steps {
        let key = extract_message_id(step);
        if !key_order.contains(&key) {
            key_order.push(key.clone());
        }
        groups_map.entry(key).or_default().push(step.clone());
    }

    let mut groups = Vec::new();
    let mut id_counter = 0u32;

    for key in &key_order {
        if let Some(group_steps) = groups_map.get(key) {
            if group_steps.is_empty() {
                continue;
            }

            id_counter += 1;
            let start_time = group_steps[0].start_time.clone();

            // Find max end time
            let end_time = group_steps
                .iter()
                .map(|s| {
                    s.end_time.clone().unwrap_or_else(|| s.start_time.clone())
                })
                .max()
                .unwrap_or_else(|| start_time.clone());

            let total_duration: f64 = group_steps.iter().map(|s| s.duration_ms).sum();

            groups.push(SemanticStepGroup {
                id: format!("group-{id_counter}"),
                label: build_group_label(group_steps),
                is_grouped: key.is_some() && group_steps.len() > 1,
                source_message_id: key.clone(),
                steps: group_steps.clone(),
                start_time,
                end_time,
                total_duration,
            });
        }
    }

    groups.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    groups
}

fn extract_message_id(step: &SemanticStep) -> Option<String> {
    if step.source_message_id.is_some() {
        return step.source_message_id.clone();
    }
    // Standalone types
    match step.step_type.as_str() {
        "subagent" | "tool_result" | "interruption" | "tool_call" => None,
        _ => None,
    }
}

fn build_group_label(steps: &[SemanticStep]) -> String {
    if steps.len() == 1 {
        let step = &steps[0];
        return match step.step_type.as_str() {
            "thinking" => "Thinking".to_string(),
            "tool_call" => format!(
                "Tool: {}",
                step.content.tool_name.as_deref().unwrap_or("Unknown")
            ),
            "tool_result" => format!(
                "Result: {}",
                if step.content.is_error == Some(true) {
                    "Error"
                } else {
                    "Success"
                }
            ),
            "subagent" => step
                .content
                .subagent_description
                .clone()
                .unwrap_or_else(|| "Subagent".to_string()),
            "output" => "Output".to_string(),
            "interruption" => "Interruption".to_string(),
            _ => "Step".to_string(),
        };
    }

    let has_thinking = steps.iter().any(|s| s.step_type == "thinking");
    let has_output = steps.iter().any(|s| s.step_type == "output");
    let tool_calls: Vec<_> = steps.iter().filter(|s| s.step_type == "tool_call").collect();

    if !tool_calls.is_empty() {
        return format!("Tools ({})", tool_calls.len());
    }
    if has_thinking && has_output {
        return "Assistant Response".to_string();
    }
    if has_thinking {
        return "Thinking".to_string();
    }
    if has_output {
        return "Output".to_string();
    }

    format!("Response ({} steps)", steps.len())
}
