//! Extracts tool results from a message and produces tool summary labels.
//! Ported from `internal/notifications/extraction.go`.

use serde_json::Value;

use crate::types::jsonl::ContentBlock;
use crate::types::messages::ParsedMessage;

use super::tool_maps::{
    extract_content_from_tool_use_result, message_blocks, tool_result_content_value,
    value_to_content_string,
};

#[derive(Debug, Clone)]
pub struct ExtractedToolResult {
    pub tool_use_id: String,
    pub is_error: bool,
    pub content: String,
    pub tool_name: Option<String>,
}

/// Collects all tool results from a message.
pub fn extract_tool_results(msg: &ParsedMessage) -> Vec<ExtractedToolResult> {
    let mut results = Vec::new();

    // From pre-extracted tool_results.
    for tr in &msg.tool_results {
        let tool_name = find_tool_name_by_id(msg, &tr.tool_use_id);
        results.push(ExtractedToolResult {
            tool_use_id: tr.tool_use_id.clone(),
            is_error: tr.is_error,
            content: value_to_content_string(&tr.content),
            tool_name,
        });
    }

    // From the raw tool_use_result JSON blob.
    if let Some(tur) = &msg.tool_use_result {
        if let Some(obj) = tur.as_object() {
            let mut is_error = obj.get("isError").and_then(Value::as_bool).unwrap_or(false);
            if !is_error {
                is_error = obj
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
            }

            let mut tool_use_id = obj
                .get("toolUseId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if tool_use_id.is_empty() {
                if let Some(src) = &msg.source_tool_use_id {
                    tool_use_id = src.clone();
                }
            }

            if !tool_use_id.is_empty() {
                let tool_name = obj
                    .get("toolName")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let content = extract_content_from_tool_use_result(tur);
                results.push(ExtractedToolResult {
                    tool_use_id,
                    is_error,
                    content,
                    tool_name,
                });
            }
        }
    }

    // From content blocks (tool_result entries).
    for block in message_blocks(msg) {
        if let ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } = block
        {
            let tool_name = find_tool_name_by_id(msg, tool_use_id);
            results.push(ExtractedToolResult {
                tool_use_id: tool_use_id.clone(),
                is_error: is_error.unwrap_or(false),
                content: tool_result_content_value(content),
                tool_name,
            });
        }
    }

    results
}

/// Searches tool calls (then the raw result blob) for a tool name by ID.
pub fn find_tool_name_by_id(msg: &ParsedMessage, tool_use_id: &str) -> Option<String> {
    for tc in &msg.tool_calls {
        if tc.id == tool_use_id {
            return Some(tc.name.clone());
        }
    }
    if let (Some(src), Some(tur)) = (&msg.source_tool_use_id, &msg.tool_use_result) {
        if src == tool_use_id {
            if let Some(name) = tur.as_object().and_then(|o| o.get("toolName")).and_then(Value::as_str) {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Produces a short human-readable label for a tool_use call.
pub fn get_tool_summary(tool_name: &str, input: &Value) -> String {
    let get_str = |field: &str| -> String {
        input
            .as_object()
            .and_then(|o| o.get(field))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };

    match tool_name {
        "Read" | "Edit" | "Write" => {
            let fp = get_str("file_path");
            if fp.is_empty() {
                return tool_name.to_string();
            }
            fp.rsplit(['/', '\\']).next().unwrap_or(&fp).to_string()
        }
        "Bash" => {
            let cmd = get_str("command");
            if cmd.is_empty() {
                return "shell command".to_string();
            }
            truncate_str(&cmd, 60)
        }
        "Grep" | "Glob" => {
            let pattern = get_str("pattern");
            if pattern.is_empty() {
                tool_name.to_string()
            } else {
                pattern
            }
        }
        _ => tool_name.to_string(),
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
}

#[cfg(test)]
#[path = "extraction_tests.rs"]
mod tests;
