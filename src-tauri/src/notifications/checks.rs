//! `checks` — the three trigger check functions: tool_result, tool_use, and
//! token_threshold. Ported from `internal/notifications/checks.go` (W14).

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::config::state::types::NotificationTrigger;
use crate::discovery::path_decoder::extract_project_name;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

use super::extraction::{extract_tool_results, get_tool_summary};
use super::tokens::{estimate_tokens, format_tokens, parse_timestamp_ms};
use super::tool_maps::{ToolResultInfo, ToolUseInfo};
use super::trigger_matcher::{extract_tool_use_field, matches_ignore_patterns, matches_pattern};
use super::types::{create_detected_error, CreateDetectedErrorParams, DetectedError};

const PREVIEW_LEN: usize = 200;

fn content_blocks(msg: &ParsedMessage) -> &[ContentBlock] {
    match &msg.content {
        ParsedMessageContent::Blocks(blocks) => blocks,
        ParsedMessageContent::Text(_) => &[],
    }
}

/// Truncates `s` to at most `max` bytes, backing off to the nearest char
/// boundary so we never split a UTF-8 sequence (Go slices raw bytes; ASCII —
/// the common case — is identical, multibyte content may trim a few bytes less).
fn truncate_bytes(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Checks a tool_result trigger against one message. Returns the first match.
pub fn check_tool_result_trigger(
    msg: &ParsedMessage,
    trigger: &NotificationTrigger,
    tool_use_map: &HashMap<String, ToolUseInfo>,
    session_id: &str,
    project_id: &str,
    file_path: &str,
    line_number: u32,
) -> Option<DetectedError> {
    let results = extract_tool_results(msg);
    let cwd_hint = msg.cwd.as_deref();

    for r in &results {
        if trigger.require_error == Some(true) {
            if !r.is_error {
                continue;
            }
            let err_msg = if r.content.is_empty() {
                "Unknown error".to_string()
            } else {
                r.content.clone()
            };
            if matches_ignore_patterns(&err_msg, trigger.ignore_patterns.as_deref()) {
                continue;
            }
            let source = r.tool_name.clone().unwrap_or_else(|| "tool_result".to_string());
            return Some(create_detected_error(CreateDetectedErrorParams {
                session_id: session_id.to_string(),
                project_id: project_id.to_string(),
                file_path: file_path.to_string(),
                project_name: extract_project_name(project_id, cwd_hint),
                line_number,
                source,
                message: err_msg,
                timestamp_ms: parse_timestamp_ms(&msg.timestamp),
                cwd: msg.cwd.clone(),
                tool_use_id: Some(r.tool_use_id.clone()),
                subagent_id: None,
                trigger_color: trigger.color.clone(),
                trigger_id: Some(trigger.id.clone()),
                trigger_name: Some(trigger.name.clone()),
            }));
        }

        if let Some(tool_name) = &trigger.tool_name {
            match tool_use_map.get(&r.tool_use_id) {
                Some(info) if &info.name == tool_name => {}
                _ => continue,
            }

            if trigger.match_field.as_deref() == Some("content") {
                let pattern = match &trigger.match_pattern {
                    Some(p) => p,
                    None => continue,
                };
                if !matches_pattern(&r.content, pattern) {
                    continue;
                }
                if matches_ignore_patterns(&r.content, trigger.ignore_patterns.as_deref()) {
                    continue;
                }
                let preview = truncate_bytes(&r.content, PREVIEW_LEN);
                return Some(create_detected_error(CreateDetectedErrorParams {
                    session_id: session_id.to_string(),
                    project_id: project_id.to_string(),
                    file_path: file_path.to_string(),
                    project_name: extract_project_name(project_id, cwd_hint),
                    line_number,
                    source: tool_name.clone(),
                    message: format!("Tool result matched: {preview}"),
                    timestamp_ms: parse_timestamp_ms(&msg.timestamp),
                    cwd: msg.cwd.clone(),
                    tool_use_id: Some(r.tool_use_id.clone()),
                    subagent_id: None,
                    trigger_color: trigger.color.clone(),
                    trigger_id: Some(trigger.id.clone()),
                    trigger_name: Some(trigger.name.clone()),
                }));
            }
        }
    }
    None
}

/// Checks a tool_use trigger against one assistant message. Returns the first match.
pub fn check_tool_use_trigger(
    msg: &ParsedMessage,
    trigger: &NotificationTrigger,
    session_id: &str,
    project_id: &str,
    file_path: &str,
    line_number: u32,
) -> Option<DetectedError> {
    if msg.message_type != "assistant" {
        return None;
    }
    let cwd_hint = msg.cwd.as_deref();

    for block in content_blocks(msg) {
        let ContentBlock::ToolUse { id, name, input } = block else {
            continue;
        };

        if let Some(tool_name) = &trigger.tool_name {
            if name != tool_name {
                continue;
            }
        }

        let field_value = match &trigger.match_field {
            Some(field) => match extract_tool_use_field(input, field) {
                Some(v) => v,
                None => continue,
            },
            None => serde_json::to_string(input).unwrap_or_default(),
        };

        if let Some(pattern) = &trigger.match_pattern {
            if !matches_pattern(&field_value, pattern) {
                continue;
            }
        }
        if matches_ignore_patterns(&field_value, trigger.ignore_patterns.as_deref()) {
            continue;
        }

        let preview = truncate_bytes(&field_value, PREVIEW_LEN);
        let label = trigger.match_field.as_deref().unwrap_or("tool_use");
        return Some(create_detected_error(CreateDetectedErrorParams {
            session_id: session_id.to_string(),
            project_id: project_id.to_string(),
            file_path: file_path.to_string(),
            project_name: extract_project_name(project_id, cwd_hint),
            line_number,
            source: name.clone(),
            message: format!("{label}: {preview}"),
            timestamp_ms: parse_timestamp_ms(&msg.timestamp),
            cwd: msg.cwd.clone(),
            tool_use_id: Some(id.clone()),
            subagent_id: None,
            trigger_color: trigger.color.clone(),
            trigger_id: Some(trigger.id.clone()),
            trigger_name: Some(trigger.name.clone()),
        }));
    }
    None
}

/// Checks a token_threshold trigger against one assistant message. Emits one
/// error per tool_use whose estimated token count exceeds the threshold.
pub fn check_token_threshold_trigger(
    msg: &ParsedMessage,
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
        Some(t) => t as i64,
        None => return errors,
    };
    if msg.message_type != "assistant" {
        return errors;
    }
    let token_type = trigger.token_type.as_deref().unwrap_or("total");
    let cwd_hint = msg.cwd.as_deref();

    // Collect tool_use blocks, deduplicating by ID (blocks first, then tool_calls).
    struct ToolUseEntry<'a> {
        id: &'a str,
        name: &'a str,
        input: &'a Value,
    }
    let mut seen: HashSet<&str> = HashSet::new();
    let mut tool_uses: Vec<ToolUseEntry> = Vec::new();

    for block in content_blocks(msg) {
        if let ContentBlock::ToolUse { id, name, input } = block {
            if seen.insert(id.as_str()) {
                tool_uses.push(ToolUseEntry {
                    id,
                    name,
                    input,
                });
            }
        }
    }
    for tc in &msg.tool_calls {
        if seen.insert(tc.id.as_str()) {
            tool_uses.push(ToolUseEntry {
                id: &tc.id,
                name: &tc.name,
                input: &tc.input,
            });
        }
    }

    for tu in &tool_uses {
        if let Some(tool_name) = &trigger.tool_name {
            if tu.name != tool_name {
                continue;
            }
        }

        let input_json = serde_json::to_string(tu.input).unwrap_or_default();
        let call_str = format!("{}{}", tu.name, input_json);
        let call_tokens = estimate_tokens(&call_str);

        let result_tokens = tool_result_map
            .get(tu.id)
            .map(|ri| estimate_tokens(&ri.content))
            .unwrap_or(0);

        let token_count = match token_type {
            "input" => call_tokens,
            "output" => result_tokens,
            _ => call_tokens + result_tokens,
        };

        if token_count <= threshold {
            continue;
        }

        let summary = get_tool_summary(tu.name, tu.input);
        let type_label = if token_type != "total" {
            format!(" {token_type}")
        } else {
            String::new()
        };
        let token_msg = format!(
            "{} - {} : ~{}{} tokens",
            tu.name,
            summary,
            format_tokens(token_count),
            type_label
        );

        if matches_ignore_patterns(&token_msg, trigger.ignore_patterns.as_deref()) {
            continue;
        }

        errors.push(create_detected_error(CreateDetectedErrorParams {
            session_id: session_id.to_string(),
            project_id: project_id.to_string(),
            file_path: file_path.to_string(),
            project_name: extract_project_name(project_id, cwd_hint),
            line_number,
            source: tu.name.to_string(),
            message: token_msg,
            timestamp_ms: parse_timestamp_ms(&msg.timestamp),
            cwd: msg.cwd.clone(),
            tool_use_id: Some(tu.id.to_string()),
            subagent_id: None,
            trigger_color: trigger.color.clone(),
            trigger_id: Some(trigger.id.clone()),
            trigger_name: Some(trigger.name.clone()),
        }));
    }

    errors
}

#[cfg(test)]
#[path = "checks_tests.rs"]
mod tests;
