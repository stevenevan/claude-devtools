// Analytics response DTOs.
// JSON tags reproduce serde rename_all="camelCase" exactly.
package analytics

// TimeBucketUsage is a single time bucket's aggregated usage.
type TimeBucketUsage struct {
	Key             string  `json:"key"`
	Label           string  `json:"label"`
	TotalTokens     uint64  `json:"totalTokens"`
	InputTokens     uint64  `json:"inputTokens"`
	OutputTokens    uint64  `json:"outputTokens"`
	CacheReadTokens uint64  `json:"cacheReadTokens"`
	CostUSD         float64 `json:"costUsd"`
	SessionCount    uint32  `json:"sessionCount"`
}

// ProjectUsageEntry — per-project aggregated usage.
type ProjectUsageEntry struct {
	ProjectName  string  `json:"projectName"`
	TotalTokens  uint64  `json:"totalTokens"`
	CostUSD      float64 `json:"costUsd"`
	SessionCount uint32  `json:"sessionCount"`
}

// ModelUsageEntry — per-model aggregated usage.
type ModelUsageEntry struct {
	Model        string  `json:"model"`
	DisplayName  string  `json:"displayName"`
	TotalTokens  uint64  `json:"totalTokens"`
	CostUSD      float64 `json:"costUsd"`
	SessionCount uint32  `json:"sessionCount"`
}

// ScheduleEventEntry — a session rendered as a calendar event.
type ScheduleEventEntry struct {
	ID           string  `json:"id"`
	ProjectName  string  `json:"projectName"`
	SessionTitle string  `json:"sessionTitle"`
	StartTime    float64 `json:"startTime"`
	EndTime      float64 `json:"endTime"`
	ProjectID    string  `json:"projectId"`
}

// TopSessionEntry — a top-N session by token count.
// model is Option<String> without skip_serializing_if → *string, no omitempty.
type TopSessionEntry struct {
	ProjectName string  `json:"projectName"`
	Title       string  `json:"title"`
	TotalTokens uint64  `json:"totalTokens"`
	CostUSD     float64 `json:"costUsd"`
	DurationMs  float64 `json:"durationMs"`
	Model       *string `json:"model"`
}

// AnalyticsResponse is the top-level analytics payload returned to the frontend.
// tool_summary is Option + skip_serializing_if → omitempty.
type AnalyticsResponse struct {
	TimeBuckets         []TimeBucketUsage    `json:"timeBuckets"`
	ProjectUsage        []ProjectUsageEntry  `json:"projectUsage"`
	ModelUsage          []ModelUsageEntry    `json:"modelUsage"`
	ScheduleEvents      []ScheduleEventEntry `json:"scheduleEvents"`
	TopSessions         []TopSessionEntry    `json:"topSessions"`
	TotalTokens         uint64               `json:"totalTokens"`
	TotalCost           float64              `json:"totalCost"`
	TotalSessions       uint32               `json:"totalSessions"`
	AvgTokensPerSession uint64               `json:"avgTokensPerSession"`
	AvgCostPerSession   float64              `json:"avgCostPerSession"`
	Granularity         BucketGranularity    `json:"granularity"`
	// ToolSummary is omitted when nil (matches serde skip_serializing_if).
	ToolSummary interface{} `json:"toolSummary,omitempty"`
}
