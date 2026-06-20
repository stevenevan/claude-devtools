package analyticsservice

import (
	"claude-devtools/internal/analytics"
	"claude-devtools/internal/cache"
)

type AnalyticsService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

func New(c *cache.SessionCache) *AnalyticsService { return &AnalyticsService{cache: c} }

func (s *AnalyticsService) Ready() (bool, error) { return true, nil }

// GetAnalytics returns aggregated usage analytics for the last `days` days.
// Mirrors commands/analytics.rs::get_analytics → compute_analytics.
func (s *AnalyticsService) GetAnalytics(days uint32) (*analytics.AnalyticsResponse, error) {
	return analytics.ComputeAnalytics(days)
}

// GetCostForecast returns a linear-regression cost forecast over `windowDays`.
// Mirrors commands/analytics.rs::get_cost_forecast → compute_cost_forecast.
func (s *AnalyticsService) GetCostForecast(windowDays uint32) (*analytics.CostForecast, error) {
	return analytics.ComputeCostForecast(windowDays)
}

// GetProductivityMetrics returns per-day productivity KPIs for the last `days` days.
// Mirrors commands/analytics.rs::get_productivity_metrics → compute_productivity_metrics.
func (s *AnalyticsService) GetProductivityMetrics(days uint32) (*analytics.ProductivityMetrics, error) {
	return analytics.ComputeProductivityMetrics(days)
}

// GetSessionDurationStats returns session duration analytics for the last `days` days.
// Mirrors commands/analytics.rs::get_session_duration_stats → compute_session_duration_stats.
func (s *AnalyticsService) GetSessionDurationStats(days uint32) (*analytics.SessionDurationResponse, error) {
	return analytics.ComputeSessionDurationStats(days)
}

// GetModelComparison returns per-model aggregated metrics for the last `days` days.
// Mirrors commands/analytics.rs::get_model_comparison → compute_model_comparison.
func (s *AnalyticsService) GetModelComparison(days uint32) (*analytics.ModelComparisonResponse, error) {
	return analytics.ComputeModelComparison(days)
}
