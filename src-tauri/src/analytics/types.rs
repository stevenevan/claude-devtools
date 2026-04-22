// Analytics response types shared across analytics/ modules and the frontend.

use serde::{Deserialize, Serialize};

use super::buckets::BucketGranularity;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeBucketUsage {
    pub key: String,
    pub label: String,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cost_usd: f64,
    pub session_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUsageEntry {
    pub project_name: String,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub session_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageEntry {
    pub model: String,
    pub display_name: String,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub session_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEventEntry {
    pub id: String,
    pub project_name: String,
    pub session_title: String,
    pub start_time: f64,
    pub end_time: f64,
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopSessionEntry {
    pub project_name: String,
    pub title: String,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub duration_ms: f64,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsResponse {
    pub time_buckets: Vec<TimeBucketUsage>,
    pub project_usage: Vec<ProjectUsageEntry>,
    pub model_usage: Vec<ModelUsageEntry>,
    pub schedule_events: Vec<ScheduleEventEntry>,
    pub top_sessions: Vec<TopSessionEntry>,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_sessions: u32,
    pub avg_tokens_per_session: u64,
    pub avg_cost_per_session: f64,
    pub granularity: BucketGranularity,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_summary: Option<crate::analysis::tool_analytics::ToolAnalyticsResponse>,
}
