use crate::analysis::error_hotspots::{self, ErrorHotspotsResponse};
use crate::analysis::tool_analytics::{self, ToolAnalyticsResponse};

#[tauri::command]
pub fn get_tool_analytics(
    project_id: String,
    days: u32,
) -> Result<ToolAnalyticsResponse, String> {
    tool_analytics::compute_tool_analytics(&project_id, days)
}

#[tauri::command]
pub fn get_error_hotspots(
    project_id: String,
    days: u32,
    min_occurrences: u32,
) -> Result<ErrorHotspotsResponse, String> {
    error_hotspots::compute_error_hotspots(&project_id, days, min_occurrences)
}
