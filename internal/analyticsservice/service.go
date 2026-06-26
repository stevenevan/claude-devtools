package analyticsservice

import (
	"fmt"
	"os"
	"path/filepath"

	"claude-devtools/internal/analytics"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/insights/error_hotspots"
	"claude-devtools/internal/insights/file_graph"
	"claude-devtools/internal/insights/tool_analytics"
	"claude-devtools/internal/insights/tool_linking"
	"claude-devtools/internal/tokenizer"
)

// CountTokens counts tokens in text using cl100k_base (commands::count_tokens).
func (s *AnalyticsService) CountTokens(text string) (int, error) {
	return tokenizer.CountTokens(text), nil
}

// CountTokensBatch counts tokens for each string (commands::count_tokens_batch).
func (s *AnalyticsService) CountTokensBatch(texts []string) ([]int, error) {
	return tokenizer.CountTokensBatch(texts), nil
}

type AnalyticsService struct{}

func New() *AnalyticsService { return &AnalyticsService{} }

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

// GetToolAnalytics returns per-tool usage stats for sessions in the last `days` days.
// Mirrors analysis/commands.rs::get_tool_analytics → compute_tool_analytics.
func (s *AnalyticsService) GetToolAnalytics(projectID string, days uint32) (*tool_analytics.ToolAnalyticsResponse, error) {
	return tool_analytics.ComputeToolAnalytics(projectID, days)
}

// GetToolTimeHeatmap returns a 7×24 heatmap of tool call frequency in local time.
// Mirrors analysis/commands.rs::get_tool_time_heatmap → compute_tool_time_heatmap.
func (s *AnalyticsService) GetToolTimeHeatmap(projectID string, days uint32, toolFilter string) (*tool_analytics.ToolTimeHeatmapResponse, error) {
	return tool_analytics.ComputeToolTimeHeatmap(projectID, days, toolFilter)
}

// GetErrorHotspots returns repeated tool errors across sessions in the last `days` days.
// Mirrors analysis/commands.rs::get_error_hotspots → compute_error_hotspots.
func (s *AnalyticsService) GetErrorHotspots(projectID string, days, minOccurrences uint32) (*error_hotspots.ErrorHotspotsResponse, error) {
	return error_hotspots.ComputeErrorHotspots(projectID, days, minOccurrences)
}

// GetErrorClusters clusters similar errors across sessions in the last `days` days.
// Mirrors analysis/commands.rs::get_error_clusters → compute_error_clusters.
func (s *AnalyticsService) GetErrorClusters(projectID string, days, minClusterSize uint32) (*error_hotspots.ErrorClustersResponse, error) {
	return error_hotspots.ComputeErrorClusters(projectID, days, minClusterSize)
}

// GetFileGraph returns the file dependency graph for a single session.
// canonicalRoot is the ~/.claude/projects directory path.
// When canonicalRoot is empty the method derives it as ~/.claude/projects,
// matching what the Rust ClaudeRoot::canonical_projects() resolves to.
// Mirrors analysis/commands.rs::get_file_graph → compute_file_graph.
func (s *AnalyticsService) GetFileGraph(canonicalRoot, projectID, sessionID string) (*file_graph.FileGraphResponse, error) {
	if canonicalRoot == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("cannot resolve home directory: %w", err)
		}
		canonicalRoot = filepath.Join(home, ".claude", "projects")
	}
	return file_graph.ComputeFileGraph(canonicalRoot, projectID, sessionID)
}

// LinkToolCalls links tool_use steps to their tool_result peers.
// Mirrors analysis/tool_linking.rs::link_tool_calls_to_results.
// Returns a map of call-ID → LinkedToolItem; callers that serialize to JSON
// MUST sort the keys to guarantee deterministic output (Go map iteration is random).
func (s *AnalyticsService) LinkToolCalls(
	steps []domain.SemanticStep,
	responses []tool_linking.ParsedMessageInput,
) map[string]tool_linking.LinkedToolItem {
	return tool_linking.LinkToolCallsToResults(steps, responses)
}
