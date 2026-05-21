use serde_json::Value;

use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

use super::tool_maps::{
    extract_content_from_tool_use_result, extract_text_from_blocks, value_to_content_string,
};

pub(super) struct ExtractedToolResult {
    pub tool_use_id: String,
    pub is_error: bool,
    pub content: String,
    pub tool_name: Option<String>,
}

pub(super) fn extract_tool_results(msg: &ParsedMessage) -> Vec<ExtractedToolResult> {
    let mut results = Vec::new();

    for tr in &msg.tool_results {
        let tool_name = find_tool_name_by_id(msg, &tr.tool_use_id);
        results.push(ExtractedToolResult {
            tool_use_id: tr.tool_use_id.clone(),
            is_error: tr.is_error,
            content: value_to_content_string(&tr.content),
            tool_name,
        });
    }

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
    for tc in &msg.tool_calls {
        if tc.id == tool_use_id {
            return Some(tc.name.clone());
        }
    }
    if msg.source_tool_use_id.as_deref() == Some(tool_use_id) {
        if let Some(ref tur) = msg.tool_use_result {
            if let Some(name) = tur.get("toolName").and_then(|v| v.as_str()) {
                return Some(name.to_string());
            }
        }
    }
    None
}

pub(super) fn get_tool_summary(tool_name: &str, input: &Value) -> String {
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
