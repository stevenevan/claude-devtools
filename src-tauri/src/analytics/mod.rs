// Analytics aggregation — computes pre-aggregated dashboard data across all projects.
// Split from monolithic analytics.rs for maintainability (sprint 18).

mod aggregate;
mod buckets;
mod cost;
mod forecasting;
mod session_scan;
mod types;

pub use aggregate::compute_analytics;
pub use buckets::BucketGranularity;
pub use forecasting::{compute_cost_forecast, CostForecast};
pub use types::{
    AnalyticsResponse, ModelUsageEntry, ProjectUsageEntry, ScheduleEventEntry, TimeBucketUsage,
    TopSessionEntry,
};
