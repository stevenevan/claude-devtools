/// Chunk types for session visualization.
/// Matches the TypeScript types in `src/main/types/chunks.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::domain::SessionMetrics;
use super::messages::{ParsedMessage, ToolCall, ToolResult};

// =============================================================================
// Process (Subagent Execution)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pub id: String,
    pub file_path: String,
    pub messages: Vec<ParsedMessage>,
    pub start_time: String,
    pub end_time: String,
    pub duration_ms: f64,
    pub metrics: SessionMetrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_type: Option<String>,
    pub is_parallel: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_ongoing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_session_impact: Option<MainSessionImpact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<TeamMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainSessionImpact {
    pub call_tokens: u64,
    pub result_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMetadata {
    pub team_name: String,
    pub member_name: String,
    pub member_color: String,
}

// =============================================================================
// Tool Execution
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecution {
    pub tool_call: ToolCall,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ToolResult>,
    pub start_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
}

// =============================================================================
// Enhanced Chunk (discriminated union via chunkType tag)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "chunkType", rename_all = "camelCase")]
pub enum EnhancedChunk {
    #[serde(rename = "user")]
    User(EnhancedUserChunk),
    #[serde(rename = "ai")]
    Ai(EnhancedAIChunk),
    #[serde(rename = "system")]
    System(EnhancedSystemChunk),
    #[serde(rename = "compact")]
    Compact(EnhancedCompactChunk),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedUserChunk {
    pub id: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_ms: f64,
    pub metrics: SessionMetrics,
    pub user_message: ParsedMessage,
    pub raw_messages: Vec<ParsedMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedAIChunk {
    pub id: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_ms: f64,
    pub metrics: SessionMetrics,
    pub responses: Vec<ParsedMessage>,
    pub processes: Vec<Process>,
    pub sidechain_messages: Vec<ParsedMessage>,
    pub tool_executions: Vec<ToolExecution>,
    pub semantic_steps: Vec<SemanticStep>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_step_groups: Option<Vec<SemanticStepGroup>>,
    pub raw_messages: Vec<ParsedMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedSystemChunk {
    pub id: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_ms: f64,
    pub metrics: SessionMetrics,
    pub message: ParsedMessage,
    pub command_output: String,
    pub raw_messages: Vec<ParsedMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedCompactChunk {
    pub id: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_ms: f64,
    pub metrics: SessionMetrics,
    pub message: ParsedMessage,
    pub raw_messages: Vec<ParsedMessage>,
}

// =============================================================================
// Semantic Step
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticStep {
    pub id: String,
    #[serde(rename = "type")]
    pub step_type: String,
    pub start_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    pub duration_ms: f64,
    pub content: SemanticStepContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<SemanticStepTokens>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_parallel: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub context: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_end_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_gap_filled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accumulated_context: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_breakdown: Option<TokenBreakdown>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticStepContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticStepTokens {
    pub input: u64,
    pub output: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBreakdown {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

// =============================================================================
// Semantic Step Group
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticStepGroup {
    pub id: String,
    pub label: String,
    pub steps: Vec<SemanticStep>,
    pub is_grouped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_message_id: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub total_duration: f64,
}

// =============================================================================
// Session Detail (complete parsed + chunked session)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub session: super::domain::Session,
    pub messages: Vec<ParsedMessage>,
    pub chunks: Vec<EnhancedChunk>,
    pub processes: Vec<Process>,
    pub metrics: SessionMetrics,
}
