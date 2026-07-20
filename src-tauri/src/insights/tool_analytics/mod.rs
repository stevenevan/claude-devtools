/// Per-tool usage analytics — call count, success/error rate, avg duration,
/// median token cost, plus weekday/hour heatmap.
mod aggregator;
mod scanner;
mod shared;

pub use aggregator::{compute_tool_analytics, compute_tool_time_heatmap};
pub use shared::{
    ToolAnalyticsResponse, ToolTimeHeatmapCell, ToolTimeHeatmapResponse, ToolUsageSummary,
};

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
