// Cost forecasting — linear regression over trailing N session-day cost totals.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::discovery::subproject_registry::SubprojectRegistry;

use super::aggregate::compute_analytics;
use super::buckets::BucketGranularity;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostForecast {
    pub projected_daily_cost_usd: f64,
    pub projected_weekly_cost_usd: f64,
    pub trend_slope_usd_per_day: f64,
    pub sample_days: u32,
    pub recent_daily_costs: Vec<f64>,
}

/// Fit a simple linear regression `y = slope * x + intercept` over `costs` using
/// index positions as x-values. Returns `(slope, intercept)`.
/// When fewer than 2 points, slope is zero and intercept is the mean.
pub fn linear_fit(costs: &[f64]) -> (f64, f64) {
    let n = costs.len();
    if n == 0 {
        return (0.0, 0.0);
    }
    if n == 1 {
        return (0.0, costs[0]);
    }

    let n_f = n as f64;
    let sum_x: f64 = (0..n).map(|i| i as f64).sum();
    let sum_y: f64 = costs.iter().sum();
    let sum_xy: f64 = costs.iter().enumerate().map(|(i, &y)| i as f64 * y).sum();
    let sum_xx: f64 = (0..n).map(|i| (i as f64) * (i as f64)).sum();

    let denom = n_f * sum_xx - sum_x * sum_x;
    if denom.abs() < f64::EPSILON {
        return (0.0, sum_y / n_f);
    }

    let slope = (n_f * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / n_f;
    (slope, intercept)
}

pub fn forecast_from_daily_costs(costs: &[f64]) -> CostForecast {
    let sample_days = costs.len() as u32;
    let (slope, intercept) = linear_fit(costs);

    // Projection: next point (x = n)
    let projected_daily = if costs.is_empty() {
        0.0
    } else {
        slope * costs.len() as f64 + intercept
    }
    .max(0.0);

    CostForecast {
        projected_daily_cost_usd: projected_daily,
        projected_weekly_cost_usd: projected_daily * 7.0,
        trend_slope_usd_per_day: slope,
        sample_days,
        recent_daily_costs: costs.to_vec(),
    }
}

/// Public entry point — pulls trailing `window_days` of daily cost totals from analytics
/// and runs linear regression.
pub fn compute_cost_forecast(
    window_days: u32,
    registry: &Arc<Mutex<SubprojectRegistry>>,
) -> Result<CostForecast, String> {
    let days = window_days.clamp(2, 90);
    let response = compute_analytics(days, registry)?;

    // Only use daily granularity for forecasting; other granularities compress
    // variance and distort the slope. If analytics used weekly/monthly, derive
    // a per-day average from total cost to still return a useful number.
    let costs: Vec<f64> = match response.granularity {
        BucketGranularity::Daily => response
            .time_buckets
            .iter()
            .map(|b| b.cost_usd)
            .collect(),
        _ => {
            // Fallback: uniform per-day average, no trend signal.
            let avg = response.total_cost / days as f64;
            vec![avg; days as usize]
        }
    };

    Ok(forecast_from_daily_costs(&costs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_fit_empty() {
        let (s, i) = linear_fit(&[]);
        assert_eq!(s, 0.0);
        assert_eq!(i, 0.0);
    }

    #[test]
    fn test_linear_fit_single() {
        let (s, i) = linear_fit(&[42.0]);
        assert_eq!(s, 0.0);
        assert_eq!(i, 42.0);
    }

    #[test]
    fn test_linear_fit_trend() {
        let (s, _) = linear_fit(&[10.0, 12.0, 14.0, 16.0]);
        assert!((s - 2.0).abs() < 1e-9);
    }

    #[test]
    fn test_forecast_matches_plan_example() {
        // Plan fixture: [10, 12, 14, 16] → slope ≈ 2, projected daily ≈ 18
        let f = forecast_from_daily_costs(&[10.0, 12.0, 14.0, 16.0]);
        assert!((f.trend_slope_usd_per_day - 2.0).abs() < 1e-9);
        assert!((f.projected_daily_cost_usd - 18.0).abs() < 1e-9);
        assert!((f.projected_weekly_cost_usd - 126.0).abs() < 1e-9);
        assert_eq!(f.sample_days, 4);
    }

    #[test]
    fn test_forecast_projection_floored_at_zero() {
        // Steep negative slope would push projection negative — cap at 0.
        let f = forecast_from_daily_costs(&[10.0, 5.0, 1.0, 0.0]);
        assert!(f.projected_daily_cost_usd >= 0.0);
    }

    #[test]
    fn test_forecast_empty() {
        let f = forecast_from_daily_costs(&[]);
        assert_eq!(f.projected_daily_cost_usd, 0.0);
        assert_eq!(f.projected_weekly_cost_usd, 0.0);
        assert_eq!(f.sample_days, 0);
    }
}
