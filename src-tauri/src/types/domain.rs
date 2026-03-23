/// Domain/business entity types — projects, sessions, metrics, pagination.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::messages::ParsedMessage;

// =============================================================================
// Project & Session
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub path: String,
    pub name: String,
    pub sessions: Vec<String>,
    pub created_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub most_recent_session: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseTokenBreakdown {
    pub phase_number: u32,
    pub contribution: u64,
    pub peak_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_compaction: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todo_data: Option<Value>,
    pub created_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_timestamp: Option<String>,
    pub has_subagents: bool,
    pub message_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_ongoing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_consumption: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compaction_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_breakdown: Option<Vec<PhaseTokenBreakdown>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
}

// =============================================================================
// Metrics
// =============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetrics {
    pub duration_ms: f64,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub message_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    /// Primary model used in this session (most frequent assistant model)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

// =============================================================================
// Parsed Session (result of full parse)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSession {
    pub messages: Vec<ParsedMessage>,
    pub metrics: SessionMetrics,
    pub task_calls: Vec<super::messages::ToolCall>,
    pub by_type: MessagesByType,
    pub sidechain_messages: Vec<ParsedMessage>,
    pub main_messages: Vec<ParsedMessage>,
    pub custom_title: Option<String>,
    pub agent_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagesByType {
    pub user: Vec<ParsedMessage>,
    pub real_user: Vec<ParsedMessage>,
    pub internal_user: Vec<ParsedMessage>,
    pub assistant: Vec<ParsedMessage>,
    pub system: Vec<ParsedMessage>,
    pub other: Vec<ParsedMessage>,
}

// =============================================================================
// Pagination
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedSessionsResult {
    pub sessions: Vec<Session>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub total_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsPaginationOptions {
    #[serde(default = "default_true")]
    pub include_total_count: bool,
    #[serde(default = "default_true")]
    pub prefilter_all: bool,
    #[serde(default = "default_deep")]
    pub metadata_level: String,
}

fn default_true() -> bool {
    true
}

fn default_deep() -> String {
    "deep".to_string()
}

impl Default for SessionsPaginationOptions {
    fn default() -> Self {
        Self {
            include_total_count: true,
            prefilter_all: true,
            metadata_level: "deep".to_string(),
        }
    }
}
