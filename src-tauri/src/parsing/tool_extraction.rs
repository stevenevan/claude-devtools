/// Extract tool calls and results from content blocks.

use serde_json::Value;

use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessageContent, ToolCall, ToolResult};

pub fn extract_tool_calls(content: &ParsedMessageContent) -> Vec<ToolCall> {
    let blocks = match content {
        ParsedMessageContent::Text(_) => return vec![],
        ParsedMessageContent::Blocks(blocks) => blocks,
    };

    let mut tool_calls = Vec::new();

    for block in blocks {
        if let ContentBlock::ToolUse { id, name, input } = block {
            let is_task = name == "Task";

            let mut tc = ToolCall {
                id: id.clone(),
                name: name.clone(),
                input: input.clone(),
                is_task,
                task_description: None,
                task_subagent_type: None,
            };

            if is_task {
                if let Value::Object(ref map) = input {
                    tc.task_description = map
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    tc.task_subagent_type = map
                        .get("subagent_type")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }

            tool_calls.push(tc);
        }
    }

    tool_calls
}

pub fn extract_tool_results(content: &ParsedMessageContent) -> Vec<ToolResult> {
    let blocks = match content {
        ParsedMessageContent::Text(_) => return vec![],
        ParsedMessageContent::Blocks(blocks) => blocks,
    };

    let mut tool_results = Vec::new();

    for block in blocks {
        if let ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } = block
        {
            tool_results.push(ToolResult {
                tool_use_id: tool_use_id.clone(),
                content: serde_json::to_value(content).unwrap_or(Value::String(String::new())),
                is_error: is_error.unwrap_or(false),
            });
        }
    }

    tool_results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_tool_calls_from_text() {
        let content = ParsedMessageContent::Text("hello".to_string());
        assert!(extract_tool_calls(&content).is_empty());
    }

    #[test]
    fn test_extract_tool_calls_from_blocks() {
        let content = ParsedMessageContent::Blocks(vec![
            ContentBlock::Text {
                text: "thinking...".to_string(),
            },
            ContentBlock::ToolUse {
                id: "tu_1".to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({"file_path": "/tmp/test.txt"}),
            },
            ContentBlock::ToolUse {
                id: "tu_2".to_string(),
                name: "Task".to_string(),
                input: serde_json::json!({"description": "search code", "subagent_type": "Explore"}),
            },
        ]);

        let calls = extract_tool_calls(&content);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "Read");
        assert!(!calls[0].is_task);
        assert_eq!(calls[1].name, "Task");
        assert!(calls[1].is_task);
        assert_eq!(calls[1].task_description.as_deref(), Some("search code"));
        assert_eq!(
            calls[1].task_subagent_type.as_deref(),
            Some("Explore")
        );
    }

    #[test]
    fn test_extract_tool_results_from_text() {
        let content = ParsedMessageContent::Text("hello".to_string());
        assert!(extract_tool_results(&content).is_empty());
    }
}
