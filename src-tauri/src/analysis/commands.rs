use crate::analysis::error_hotspots::{self, ErrorClustersResponse, ErrorHotspotsResponse};
use crate::analysis::tool_analytics::{self, ToolAnalyticsResponse, ToolTimeHeatmapResponse};

#[tauri::command]
pub fn get_tool_analytics(
    project_id: String,
    days: u32,
) -> Result<ToolAnalyticsResponse, String> {
    tool_analytics::compute_tool_analytics(&project_id, days)
}

#[tauri::command]
pub fn get_tool_time_heatmap(
    project_id: String,
    days: u32,
    tool_filter: Option<String>,
) -> Result<ToolTimeHeatmapResponse, String> {
    tool_analytics::compute_tool_time_heatmap(&project_id, days, tool_filter.as_deref())
}

#[tauri::command]
pub fn get_error_hotspots(
    project_id: String,
    days: u32,
    min_occurrences: u32,
) -> Result<ErrorHotspotsResponse, String> {
    error_hotspots::compute_error_hotspots(&project_id, days, min_occurrences)
}

#[tauri::command]
pub fn get_error_clusters(
    project_id: String,
    days: u32,
    min_cluster_size: u32,
) -> Result<ErrorClustersResponse, String> {
    error_hotspots::compute_error_clusters(&project_id, days, min_cluster_size)
}
