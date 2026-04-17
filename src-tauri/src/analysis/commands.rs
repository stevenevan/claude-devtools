use crate::analysis::tool_analytics::{self, ToolAnalyticsResponse};

#[tauri::command]
pub fn get_tool_analytics(
    project_id: String,
    days: u32,
) -> Result<ToolAnalyticsResponse, String> {
    tool_analytics::compute_tool_analytics(&project_id, days)
}
