// Analytics aggregation — computes pre-aggregated dashboard data across all projects.
// Split from monolithic analytics.rs for maintainability (sprint 18).

mod aggregate;
mod buckets;
mod cost;
mod duration;
mod forecasting;
mod model_comparison;
mod productivity;
mod session_scan;
mod simple_cost_summary;
mod types;

pub use aggregate::compute_analytics;
pub use buckets::BucketGranularity;
pub use duration::{compute_session_duration_stats, SessionDurationResponse};
pub use forecasting::{compute_cost_forecast, CostForecast};
pub use model_comparison::{compute_model_comparison, ModelComparisonResponse};
pub use productivity::{compute_productivity_metrics, ProductivityMetrics};
pub(crate) use session_scan::scan_session_light;
#[cfg(test)]
pub(crate) use session_scan::{light_scan_count, reset_light_scan_count};
pub use simple_cost_summary::{
    compute_simple_cost_summary, SimpleCostCompleteness, SimpleCostDailyPoint, SimpleCostPeriod,
    SimpleCostProjectTotal, SimpleCostSummary,
};
pub use types::{
    AnalyticsResponse, ModelUsageEntry, ProjectUsageEntry, ScheduleEventEntry, TimeBucketUsage,
    TopSessionEntry,
};
