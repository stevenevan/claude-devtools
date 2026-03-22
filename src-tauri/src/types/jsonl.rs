/// Raw JSONL entry types — the exact format stored in Claude Code session files.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// =============================================================================
// Content Blocks
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
        signature: String,
    },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: ToolResultContentValue,
        #[serde(default)]
        is_error: Option<bool>,
    },
    Image {
        source: ImageSource,
    },
}

/// Tool result content can be a string or an array of content blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolResultContentValue {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

// =============================================================================
// JSONL Entries
// =============================================================================

/// Raw JSONL entry — deserialized loosely to handle all entry types.
/// We use a single struct with optional fields rather than a tagged enum
/// because the `type` field values overlap with nested message types,
/// and entries can have varying shapes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawJsonlEntry {
    // Base fields
    #[serde(rename = "type")]
    pub entry_type: String,
    pub timestamp: Option<String>,
    pub uuid: Option<String>,

    // Conversational fields
    pub parent_uuid: Option<String>,
    #[serde(default)]
    pub is_sidechain: bool,
    pub user_type: Option<String>,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,

    // User entry fields
    pub message: Option<Value>,
    #[serde(default)]
    pub is_meta: Option<bool>,
    pub agent_id: Option<String>,
    pub tool_use_result: Option<Value>,
    pub source_tool_use_id: Option<String>,
    #[serde(rename = "sourceToolAssistantUUID")]
    pub source_tool_assistant_uuid: Option<String>,

    // Assistant entry fields
    pub request_id: Option<String>,

    // Compact summary marker
    #[serde(default)]
    pub is_compact_summary: Option<bool>,

    // System entry fields
    pub subtype: Option<String>,
    pub level: Option<String>,
    pub url: Option<String>,
    pub content: Option<String>,

    // api_error fields
    pub error: Option<Value>,
    #[serde(rename = "retryInMs")]
    pub retry_in_ms: Option<f64>,
    #[serde(rename = "retryAttempt")]
    pub retry_attempt: Option<u32>,
    #[serde(rename = "maxRetries")]
    pub max_retries: Option<u32>,
    pub cause: Option<Value>,

    // memory_saved fields
    #[serde(rename = "writtenPaths")]
    pub written_paths: Option<Vec<String>>,
    pub verb: Option<String>,

    // turn_duration field
    #[serde(rename = "durationMs")]
    pub duration_ms: Option<f64>,

    // queue-operation fields
    pub operation: Option<String>,

    // progress fields
    pub data: Option<Value>,
    #[serde(rename = "toolUseID")]
    pub tool_use_id_ref: Option<String>,
    #[serde(rename = "parentToolUseID")]
    pub parent_tool_use_id: Option<String>,

    // Session metadata fields (custom-title, agent-name)
    #[serde(rename = "customTitle")]
    pub custom_title: Option<String>,
    #[serde(rename = "agentName")]
    pub agent_name: Option<String>,
}
