use std::collections::HashMap;

use serde_json::Value;

use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

pub struct ToolUseInfo {
    pub name: String,
}

pub struct ToolResultInfo {
    pub content: String,
}

pub fn build_tool_use_map(messages: &[ParsedMessage]) -> HashMap<String, ToolUseInfo> {
    let mut map = HashMap::new();
    for msg in messages {
        if msg.message_type != "assistant" {
            continue;
        }
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
        for tc in &msg.tool_calls {
            map.entry(tc.id.clone()).or_insert_with(|| ToolUseInfo {
                name: tc.name.clone(),
            });
        }
    }
    map
}

pub fn build_tool_result_map(messages: &[ParsedMessage]) -> HashMap<String, ToolResultInfo> {
    let mut map = HashMap::new();
    for msg in messages {
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
        for tr in &msg.tool_results {
            let content_str = value_to_content_string(&tr.content);
            map.entry(tr.tool_use_id.clone())
                .or_insert_with(|| ToolResultInfo {
                    content: content_str,
                });
        }
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

pub(super) fn extract_text_from_blocks(blocks: &[ContentBlock]) -> String {
    let mut texts = Vec::new();
    for block in blocks {
        if let ContentBlock::Text { text } = block {
            texts.push(text.as_str());
        }
    }
    texts.join("\n")
}

pub(super) fn value_to_content_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        _ => v.to_string(),
    }
}

pub(super) fn extract_content_from_tool_use_result(tur: &Value) -> String {
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
