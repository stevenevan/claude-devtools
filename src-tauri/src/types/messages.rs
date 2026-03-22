/// ParsedMessage — the application's internal representation after parsing raw JSONL entries.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::jsonl::ContentBlock;

// =============================================================================
// Tool Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
    pub is_task: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_subagent_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: Value,
    pub is_error: bool,
}

// =============================================================================
// Message Content (string | ContentBlock[])
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParsedMessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

// =============================================================================
// Parsed Message
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMessage {
    pub uuid: String,
    pub parent_uuid: Option<String>,
    #[serde(rename = "type")]
    pub message_type: String,
    /// ISO-8601 timestamp string (frontend handles conversion)
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub content: ParsedMessageContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    // Metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub is_sidechain: bool,
    pub is_meta: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_type: Option<String>,
    // Tool information
    pub tool_calls: Vec<ToolCall>,
    pub tool_results: Vec<ToolResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "sourceToolUseID")]
    pub source_tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "sourceToolAssistantUUID")]
    pub source_tool_assistant_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_compact_summary: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

// =============================================================================
// Token Usage
// =============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
}

// =============================================================================
// Message Category
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageCategory {
    User,
    System,
    HardNoise,
    Ai,
    Compact,
}
