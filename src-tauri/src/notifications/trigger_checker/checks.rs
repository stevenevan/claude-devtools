use std::collections::HashMap;

use serde_json::Value;

use crate::config::types::NotificationTrigger;
use crate::discovery::path_decoder;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

use super::super::trigger_matcher::{extract_tool_use_field, matches_ignore_patterns, matches_pattern};
use super::super::types::{create_detected_error, CreateDetectedErrorParams, DetectedError};
use super::extraction::{extract_tool_results, get_tool_summary};
use super::tokens::{estimate_tokens, format_tokens, parse_timestamp_ms};
use super::tool_maps::{ToolResultInfo, ToolUseInfo};

/// Check a tool_result trigger against a message.
pub fn check_tool_result_trigger(
    message: &ParsedMessage,
    trigger: &NotificationTrigger,
    tool_use_map: &HashMap<String, ToolUseInfo>,
    session_id: &str,
    project_id: &str,
    file_path: &str,
    line_number: u32,
) -> Option<DetectedError> {
    let results = extract_tool_results(message);

    for result in &results {
        if trigger.require_error == Some(true) {
            if !result.is_error {
                continue;
            }
            let error_msg = if result.content.trim().is_empty() {
                "Unknown error".to_string()
            } else {
                result.content.clone()
            };

            if matches_ignore_patterns(
                &error_msg,
                trigger.ignore_patterns.as_deref(),
            ) {
                continue;
            }

            return Some(create_detected_error(CreateDetectedErrorParams {
                session_id: session_id.to_string(),
                project_id: project_id.to_string(),
                file_path: file_path.to_string(),
                project_name: path_decoder::extract_project_name(
                    project_id,
                    message.cwd.as_deref(),
                ),
                line_number,
                source: result
                    .tool_name
                    .clone()
                    .unwrap_or_else(|| "tool_result".to_string()),
                message: error_msg,
                timestamp_ms: parse_timestamp_ms(&message.timestamp),
                cwd: message.cwd.clone(),
                tool_use_id: Some(result.tool_use_id.clone()),
                subagent_id: None,
                trigger_color: trigger.color.clone(),
                trigger_id: Some(trigger.id.clone()),
                trigger_name: Some(trigger.name.clone()),
            }));
        }

        if let Some(ref trig_tool) = trigger.tool_name {
            let tool_use = tool_use_map.get(&result.tool_use_id);
            if tool_use.map(|t| t.name.as_str()) != Some(trig_tool.as_str()) {
                continue;
            }

            if trigger.match_field.as_deref() == Some("content") {
                if let Some(ref pat) = trigger.match_pattern {
                    if !matches_pattern(&result.content, pat) {
                        continue;
                    }
                    if matches_ignore_patterns(
                        &result.content,
                        trigger.ignore_patterns.as_deref(),
                    ) {
                        continue;
                    }
                    let preview = if result.content.len() > 200 {
                        &result.content[..200]
                    } else {
                        &result.content
                    };
                    return Some(create_detected_error(CreateDetectedErrorParams {
                        session_id: session_id.to_string(),
                        project_id: project_id.to_string(),
                        file_path: file_path.to_string(),
                        project_name: path_decoder::extract_project_name(
                            project_id,
                            message.cwd.as_deref(),
                        ),
                        line_number,
                        source: trig_tool.clone(),
                        message: format!("Tool result matched: {preview}"),
                        timestamp_ms: parse_timestamp_ms(&message.timestamp),
                        cwd: message.cwd.clone(),
                        tool_use_id: Some(result.tool_use_id.clone()),
                        subagent_id: None,
                        trigger_color: trigger.color.clone(),
                        trigger_id: Some(trigger.id.clone()),
                        trigger_name: Some(trigger.name.clone()),
                    }));
                }
            }
        }
    }

    None
}

/// Check a tool_use trigger against a message.
pub fn check_tool_use_trigger(
    message: &ParsedMessage,
    trigger: &NotificationTrigger,
    session_id: &str,
    project_id: &str,
    file_path: &str,
    line_number: u32,
) -> Option<DetectedError> {
    if message.message_type != "assistant" {
        return None;
    }

    let blocks = match &message.content {
        ParsedMessageContent::Blocks(b) => b,
        _ => return None,
    };

    for block in blocks {
        let (id, name, input) = match block {
            ContentBlock::ToolUse { id, name, input } => (id, name, input),
            _ => continue,
        };

        if let Some(ref trig_tool) = trigger.tool_name {
            if name != trig_tool {
                continue;
            }
        }

        let field_value = if let Some(ref mf) = trigger.match_field {
            extract_tool_use_field(input, mf)
        } else {
            Some(input.to_string())
        };

        let field_value = match field_value {
            Some(v) => v,
            None => continue,
        };

        if let Some(ref pat) = trigger.match_pattern {
            if !matches_pattern(&field_value, pat) {
                continue;
            }
        }

        if matches_ignore_patterns(&field_value, trigger.ignore_patterns.as_deref()) {
            continue;
        }

        let preview = if field_value.len() > 200 {
            &field_value[..200]
        } else {
            &field_value
        };
        let label = trigger
            .match_field
            .as_deref()
            .unwrap_or("tool_use");

        return Some(create_detected_error(CreateDetectedErrorParams {
            session_id: session_id.to_string(),
            project_id: project_id.to_string(),
            file_path: file_path.to_string(),
            project_name: path_decoder::extract_project_name(
                project_id,
                message.cwd.as_deref(),
            ),
            line_number,
            source: name.clone(),
            message: format!("{label}: {preview}"),
            timestamp_ms: parse_timestamp_ms(&message.timestamp),
            cwd: message.cwd.clone(),
            tool_use_id: Some(id.clone()),
            subagent_id: None,
            trigger_color: trigger.color.clone(),
            trigger_id: Some(trigger.id.clone()),
            trigger_name: Some(trigger.name.clone()),
        }));
    }

    None
}

/// Check a token_threshold trigger against a message.
/// Returns multiple errors (one per tool_use exceeding threshold).
pub fn check_token_threshold_trigger(
    message: &ParsedMessage,
    trigger: &NotificationTrigger,
    tool_result_map: &HashMap<String, ToolResultInfo>,
    session_id: &str,
    project_id: &str,
    file_path: &str,
    line_number: u32,
) -> Vec<DetectedError> {
    let mut errors = Vec::new();

    if trigger.mode != "token_threshold" {
        return errors;
    }
    let threshold = match trigger.token_threshold {
        Some(t) => t as usize,
        None => return errors,
    };

    if message.message_type != "assistant" {
        return errors;
    }

    let token_type = trigger.token_type.as_deref().unwrap_or("total");

    let mut tool_uses: Vec<(String, String, Value)> = Vec::new();
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    if let ParsedMessageContent::Blocks(blocks) = &message.content {
        for block in blocks {
            if let ContentBlock::ToolUse { id, name, input } = block {
                if seen_ids.insert(id.clone()) {
                    tool_uses.push((id.clone(), name.clone(), input.clone()));
                }
            }
        }
    }
    for tc in &message.tool_calls {
        if seen_ids.insert(tc.id.clone()) {
            tool_uses.push((tc.id.clone(), tc.name.clone(), tc.input.clone()));
        }
    }

    if tool_uses.is_empty() {
        return errors;
    }

    for (id, name, input) in &tool_uses {
        if let Some(ref trig_tool) = trigger.tool_name {
            if name != trig_tool {
                continue;
            }
        }

        let call_str = format!("{name}{}", serde_json::to_string(input).unwrap_or_default());
        let call_tokens = estimate_tokens(&call_str);

        let result_tokens = tool_result_map
            .get(id)
            .map(|r| estimate_tokens(&r.content))
            .unwrap_or(0);

        let token_count = match token_type {
            "input" => call_tokens,
            "output" => result_tokens,
            _ => call_tokens + result_tokens,
        };

        if token_count <= threshold {
            continue;
        }

        let summary = get_tool_summary(name, input);
        let type_label = if token_type == "total" {
            String::new()
        } else {
            format!(" {token_type}")
        };
        let token_msg =
            format!("{name} - {summary} : ~{}{type_label} tokens", format_tokens(token_count));

        if matches_ignore_patterns(&token_msg, trigger.ignore_patterns.as_deref()) {
            continue;
        }

        errors.push(create_detected_error(CreateDetectedErrorParams {
            session_id: session_id.to_string(),
            project_id: project_id.to_string(),
            file_path: file_path.to_string(),
            project_name: path_decoder::extract_project_name(
                project_id,
                message.cwd.as_deref(),
            ),
            line_number,
            source: name.clone(),
            message: token_msg,
            timestamp_ms: parse_timestamp_ms(&message.timestamp),
            cwd: message.cwd.clone(),
            tool_use_id: Some(id.clone()),
            subagent_id: None,
            trigger_color: trigger.color.clone(),
            trigger_id: Some(trigger.id.clone()),
            trigger_name: Some(trigger.name.clone()),
        }));
    }

    errors
}
