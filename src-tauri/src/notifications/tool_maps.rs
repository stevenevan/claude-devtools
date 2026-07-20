//! Builds tool_use / tool_result index maps from a parsed message slice.
//! Ported from `internal/notifications/tool_maps.go`.

use std::collections::HashMap;

use serde_json::Value;

use crate::types::jsonl::{ContentBlock, ToolResultContentValue};
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

#[derive(Debug, Clone)]
pub struct ToolUseInfo {
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct ToolResultInfo {
    pub content: String,
}

/// Content blocks of a message, or an empty slice when the content is text.
pub(crate) fn message_blocks(msg: &ParsedMessage) -> &[ContentBlock] {
    match &msg.content {
        ParsedMessageContent::Blocks(blocks) => blocks,
        ParsedMessageContent::Text(_) => &[],
    }
}

/// Indexes tool_use blocks by ID across assistant messages.
pub fn build_tool_use_map(messages: &[ParsedMessage]) -> HashMap<String, ToolUseInfo> {
    let mut map = HashMap::new();
    for msg in messages {
        if msg.message_type != "assistant" {
            continue;
        }
        for block in message_blocks(msg) {
            if let ContentBlock::ToolUse { id, name, .. } = block {
                map.insert(id.clone(), ToolUseInfo { name: name.clone() });
            }
        }
        for tc in &msg.tool_calls {
            map.entry(tc.id.clone())
                .or_insert_with(|| ToolUseInfo { name: tc.name.clone() });
        }
    }
    map
}

/// Indexes tool_result content by tool_use ID.
pub fn build_tool_result_map(messages: &[ParsedMessage]) -> HashMap<String, ToolResultInfo> {
    let mut map = HashMap::new();
    for msg in messages {
        for block in message_blocks(msg) {
            if let ContentBlock::ToolResult {
                tool_use_id,
                content,
                ..
            } = block
            {
                let value = tool_result_content_value(content);
                map.entry(tool_use_id.clone())
                    .or_insert_with(|| ToolResultInfo { content: value });
            }
        }
        for tr in &msg.tool_results {
            let value = value_to_content_string(&tr.content);
            map.entry(tr.tool_use_id.clone())
                .or_insert_with(|| ToolResultInfo { content: value });
        }
        if let (Some(tur), Some(source_id)) = (&msg.tool_use_result, &msg.source_tool_use_id) {
            let value = extract_content_from_tool_use_result(tur);
            map.entry(source_id.clone())
                .or_insert_with(|| ToolResultInfo { content: value });
        }
    }
    map
}

/// Extracts string content from a tool_result content value.
pub(crate) fn tool_result_content_value(v: &ToolResultContentValue) -> String {
    match v {
        ToolResultContentValue::Text(s) => s.clone(),
        ToolResultContentValue::Blocks(blocks) => extract_text_from_blocks(blocks),
    }
}

/// Joins text blocks with newlines.
fn extract_text_from_blocks(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|b| match b {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Converts a JSON value to a string: strings unwrap, null → "", else JSON text.
pub(crate) fn value_to_content_string(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Extracts the most useful text from a tool_use_result JSON object.
pub(crate) fn extract_content_from_tool_use_result(v: &Value) -> String {
    let obj = match v.as_object() {
        Some(o) => o,
        None => return String::new(),
    };
    let get_str = |key: &str| -> String {
        obj.get(key)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    };
    for key in ["error", "stderr", "content"] {
        let s = get_str(key);
        if !s.is_empty() {
            return s;
        }
    }
    get_str("message")
}

#[cfg(test)]
#[path = "tool_maps_tests.rs"]
mod tests;
