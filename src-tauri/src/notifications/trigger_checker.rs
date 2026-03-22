/// TriggerChecker — checks tool_result, tool_use, and token_threshold triggers.

use std::collections::HashMap;

use serde_json::Value;

use crate::config::types::NotificationTrigger;
use crate::discovery::path_decoder;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

use super::trigger_matcher::{extract_tool_use_field, matches_ignore_patterns, matches_pattern};
use super::types::{create_detected_error, CreateDetectedErrorParams, DetectedError};

// =============================================================================
// Tool Map Types
// =============================================================================

pub struct ToolUseInfo {
    pub name: String,
}

pub struct ToolResultInfo {
    pub content: String,
}

// =============================================================================
// Map Building
// =============================================================================

/// Builds a map of tool_use_id → ToolUseInfo from assistant messages.
pub fn build_tool_use_map(messages: &[ParsedMessage]) -> HashMap<String, ToolUseInfo> {
    let mut map = HashMap::new();
    for msg in messages {
        if msg.message_type != "assistant" {
            continue;
        }
        // From content blocks
        if let ParsedMessageContent::Blocks(blocks) = &msg.content {
            for block in blocks {
                if let ContentBlock::ToolUse { id, name, .. } = block {
                    map.insert(
                        id.clone(),
                        ToolUseInfo {
                            name: name.clone(),
                        },
                    );
                }
            }
        }
        // From toolCalls
        for tc in &msg.tool_calls {
            map.entry(tc.id.clone()).or_insert_with(|| ToolUseInfo {
                name: tc.name.clone(),
            });
        }
    }
    map
}

/// Builds a map of tool_use_id → ToolResultInfo from messages.
pub fn build_tool_result_map(messages: &[ParsedMessage]) -> HashMap<String, ToolResultInfo> {
    let mut map = HashMap::new();
    for msg in messages {
        // From content blocks
        if let ParsedMessageContent::Blocks(blocks) = &msg.content {
            for block in blocks {
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    ..
                } = block
                {
                    let content_str = match content {
                        crate::types::jsonl::ToolResultContentValue::Text(s) => s.clone(),
                        crate::types::jsonl::ToolResultContentValue::Blocks(inner) => {
                            extract_text_from_blocks(inner)
                        }
                    };
                    map.insert(
                        tool_use_id.clone(),
                        ToolResultInfo {
                            content: content_str,
                        },
                    );
                }
            }
        }
        // From toolResults array
        for tr in &msg.tool_results {
            let content_str = value_to_content_string(&tr.content);
            map.entry(tr.tool_use_id.clone())
                .or_insert_with(|| ToolResultInfo {
                    content: content_str,
                });
        }
        // From toolUseResult
        if let (Some(ref tur), Some(ref stuid)) =
            (&msg.tool_use_result, &msg.source_tool_use_id)
        {
            let content_str = extract_content_from_tool_use_result(tur);
            map.entry(stuid.clone()).or_insert_with(|| ToolResultInfo {
                content: content_str,
            });
        }
    }
    map
}

fn extract_text_from_blocks(blocks: &[ContentBlock]) -> String {
    let mut texts = Vec::new();
    for block in blocks {
        if let ContentBlock::Text { text } = block {
            texts.push(text.as_str());
        }
    }
    texts.join("\n")
}

fn value_to_content_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        _ => v.to_string(),
    }
}

fn extract_content_from_tool_use_result(tur: &Value) -> String {
    if let Some(s) = tur.get("error").and_then(|v| v.as_str()) {
        return s.to_string();
    }
    if let Some(s) = tur.get("stderr").and_then(|v| v.as_str()) {
        if !s.trim().is_empty() {
            return s.to_string();
        }
    }
    if let Some(s) = tur.get("content").and_then(|v| v.as_str()) {
        return s.to_string();
    }
    if let Some(s) = tur.get("message").and_then(|v| v.as_str()) {
        return s.to_string();
    }
    String::new()
}

// =============================================================================
// Token Estimation
// =============================================================================

/// Estimate token count: ~4 chars per token (ceiling).
pub fn estimate_tokens(content: &str) -> usize {
    (content.len() + 3) / 4
}

/// Format token count for display (e.g. 500, 1.5k, 15k).
fn format_tokens(count: usize) -> String {
    if count < 1000 {
        count.to_string()
    } else {
        let k = count as f64 / 1000.0;
        if k < 10.0 {
            format!("{:.1}k", k)
        } else {
            format!("{:.0}k", k)
        }
    }
}

// =============================================================================
// Tool Result Extraction (for trigger checking)
// =============================================================================

struct ExtractedToolResult {
    tool_use_id: String,
    is_error: bool,
    content: String,
    tool_name: Option<String>,
}

/// Extract tool results from a message for trigger matching.
fn extract_tool_results(msg: &ParsedMessage) -> Vec<ExtractedToolResult> {
    let mut results = Vec::new();

    // Pattern 1: toolResults array
    for tr in &msg.tool_results {
        let tool_name = find_tool_name_by_id(msg, &tr.tool_use_id);
        results.push(ExtractedToolResult {
            tool_use_id: tr.tool_use_id.clone(),
            is_error: tr.is_error,
            content: value_to_content_string(&tr.content),
            tool_name,
        });
    }

    // Pattern 2: toolUseResult
    if let Some(ref tur) = msg.tool_use_result {
        let is_error = tur.get("isError").and_then(|v| v.as_bool()).unwrap_or(false)
            || tur
                .get("is_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
        let tool_use_id = tur
            .get("toolUseId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| msg.source_tool_use_id.clone());
        if let Some(tuid) = tool_use_id {
            let tool_name = tur
                .get("toolName")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            results.push(ExtractedToolResult {
                tool_use_id: tuid,
                is_error,
                content: extract_content_from_tool_use_result(tur),
                tool_name,
            });
        }
    }

    // Pattern 3: content blocks
    if let ParsedMessageContent::Blocks(blocks) = &msg.content {
        for block in blocks {
            if let ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } = block
            {
                let content_str = match content {
                    crate::types::jsonl::ToolResultContentValue::Text(s) => s.clone(),
                    crate::types::jsonl::ToolResultContentValue::Blocks(inner) => {
                        extract_text_from_blocks(inner)
                    }
                };
                let tool_name = find_tool_name_by_id(msg, tool_use_id);
                results.push(ExtractedToolResult {
                    tool_use_id: tool_use_id.clone(),
                    is_error: is_error.unwrap_or(false),
                    content: content_str,
                    tool_name,
                });
            }
        }
    }

    results
}

fn find_tool_name_by_id(msg: &ParsedMessage, tool_use_id: &str) -> Option<String> {
    // Check toolCalls
    for tc in &msg.tool_calls {
        if tc.id == tool_use_id {
            return Some(tc.name.clone());
        }
    }
    // Check sourceToolUseID
    if msg.source_tool_use_id.as_deref() == Some(tool_use_id) {
        if let Some(ref tur) = msg.tool_use_result {
            if let Some(name) = tur.get("toolName").and_then(|v| v.as_str()) {
                return Some(name.to_string());
            }
        }
    }
    None
}

// =============================================================================
// Tool Summary (simplified)
// =============================================================================

fn get_tool_summary(tool_name: &str, input: &Value) -> String {
    let get_str = |field: &str| -> Option<&str> { input.get(field)?.as_str() };

    match tool_name {
        "Read" | "Edit" | "Write" => {
            if let Some(fp) = get_str("file_path") {
                let name = fp.rsplit('/').next().unwrap_or(fp);
                return name.to_string();
            }
            tool_name.to_string()
        }
        "Bash" => {
            if let Some(cmd) = get_str("command") {
                let truncated = if cmd.len() > 60 {
                    format!("{}...", &cmd[..60])
                } else {
                    cmd.to_string()
                };
                return truncated;
            }
            "shell command".to_string()
        }
        "Grep" | "Glob" => {
            if let Some(p) = get_str("pattern") {
                return p.to_string();
            }
            tool_name.to_string()
        }
        _ => tool_name.to_string(),
    }
}

// =============================================================================
// Trigger Checkers
// =============================================================================

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

        // Non-error tool_result trigger with toolName
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

        // Check tool name filter
        if let Some(ref trig_tool) = trigger.tool_name {
            if name != trig_tool {
                continue;
            }
        }

        // Extract field to match
        let field_value = if let Some(ref mf) = trigger.match_field {
            extract_tool_use_field(input, mf)
        } else {
            // No matchField → match entire input JSON
            Some(input.to_string())
        };

        let field_value = match field_value {
            Some(v) => v,
            None => continue,
        };

        // Check match pattern
        if let Some(ref pat) = trigger.match_pattern {
            if !matches_pattern(&field_value, pat) {
                continue;
            }
        }

        // Check ignore patterns
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

    // Collect tool_use blocks (deduplicated)
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
        // Check tool name filter
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

// =============================================================================
// Helpers
// =============================================================================

/// Parse ISO-8601 timestamp string to epoch milliseconds.
fn parse_timestamp_ms(ts: &str) -> f64 {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|dt| dt.timestamp_millis() as f64)
        .unwrap_or(0.0)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_tokens() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
        assert_eq!(estimate_tokens("abcdefgh"), 2);
    }

    #[test]
    fn test_format_tokens() {
        assert_eq!(format_tokens(500), "500");
        assert_eq!(format_tokens(1500), "1.5k");
        assert_eq!(format_tokens(15000), "15k");
    }

    #[test]
    fn test_parse_timestamp_ms() {
        let ts = "2024-01-15T10:30:00Z";
        let ms = parse_timestamp_ms(ts);
        assert!(ms > 0.0);
    }

    #[test]
    fn test_get_tool_summary_read() {
        let input = serde_json::json!({"file_path": "/Users/me/project/src/main.rs"});
        assert_eq!(get_tool_summary("Read", &input), "main.rs");
    }

    #[test]
    fn test_get_tool_summary_bash() {
        let input = serde_json::json!({"command": "ls -la"});
        assert_eq!(get_tool_summary("Bash", &input), "ls -la");
    }
}
