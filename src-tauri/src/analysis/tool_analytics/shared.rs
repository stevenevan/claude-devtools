use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsageSummary {
    pub tool_name: String,
    pub call_count: u32,
    pub success_count: u32,
    pub error_count: u32,
    pub success_rate: f64,
    pub error_rate: f64,
    pub avg_duration_ms: f64,
    pub median_token_cost: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnalyticsResponse {
    pub tools: Vec<ToolUsageSummary>,
    pub total_calls: u32,
    pub total_errors: u32,
    pub scanned_sessions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolTimeHeatmapCell {
    /// 0 = Monday, 6 = Sunday (chrono `num_days_from_monday`).
    pub day_of_week: u8,
    /// 0..=23 local-timezone hour.
    pub hour: u8,
    pub call_count: u32,
    pub top_tool: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolTimeHeatmapResponse {
    pub cells: Vec<ToolTimeHeatmapCell>,
    pub total_calls: u32,
    pub tool_names: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct RawEntry {
    pub(super) timestamp: Option<String>,
    pub(super) message: Option<RawMessage>,
}

#[derive(Deserialize)]
pub(super) struct RawMessage {
    pub(super) role: Option<String>,
    pub(super) content: Option<serde_json::Value>,
}

pub(super) struct ToolCallStart {
    pub(super) tool_name: String,
    pub(super) start_ms: f64,
}

#[derive(Default)]
pub(super) struct ToolStats {
    pub(super) call_count: u32,
    pub(super) success_count: u32,
    pub(super) error_count: u32,
    pub(super) duration_samples: Vec<f64>,
    pub(super) token_samples: Vec<u64>,
}

/// 7 (days) x 24 (hours) heatmap bucket key = day * 24 + hour.
pub(super) type HeatmapKey = u8;

#[derive(Default)]
pub(super) struct HeatmapCellAcc {
    pub(super) total: u32,
    pub(super) per_tool: std::collections::HashMap<String, u32>,
}

pub(super) fn heatmap_key(day: u8, hour: u8) -> HeatmapKey {
    day * 24 + hour
}

pub(super) fn parse_timestamp_ms(ts: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis() as f64)
}

pub(super) fn tool_result_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|block| {
                let kind = block.get("type")?.as_str()?;
                if kind == "text" {
                    block.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}
