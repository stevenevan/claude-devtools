// Package tool_analytics ports src-tauri/src/analysis/tool_analytics/ to Go.
// Backs the get_tool_analytics and get_tool_time_heatmap commands.
package tool_analytics

// ToolUsageSummary mirrors the Rust ToolUsageSummary struct.
type ToolUsageSummary struct {
	ToolName        string  `json:"toolName"`
	CallCount       uint32  `json:"callCount"`
	SuccessCount    uint32  `json:"successCount"`
	ErrorCount      uint32  `json:"errorCount"`
	SuccessRate     float64 `json:"successRate"`
	ErrorRate       float64 `json:"errorRate"`
	AvgDurationMs   float64 `json:"avgDurationMs"`
	MedianTokenCost uint64  `json:"medianTokenCost"`
}

// ToolAnalyticsResponse mirrors the Rust ToolAnalyticsResponse struct.
type ToolAnalyticsResponse struct {
	Tools           []ToolUsageSummary `json:"tools"`
	TotalCalls      uint32             `json:"totalCalls"`
	TotalErrors     uint32             `json:"totalErrors"`
	ScannedSessions uint32             `json:"scannedSessions"`
}

// ToolTimeHeatmapCell mirrors the Rust ToolTimeHeatmapCell struct.
// DayOfWeek: 0=Monday, 6=Sunday.
type ToolTimeHeatmapCell struct {
	DayOfWeek uint8   `json:"dayOfWeek"`
	Hour      uint8   `json:"hour"`
	CallCount uint32  `json:"callCount"`
	TopTool   *string `json:"topTool,omitempty"`
}

// ToolTimeHeatmapResponse mirrors the Rust ToolTimeHeatmapResponse struct.
type ToolTimeHeatmapResponse struct {
	Cells      []ToolTimeHeatmapCell `json:"cells"`
	TotalCalls uint32                `json:"totalCalls"`
	ToolNames  []string              `json:"toolNames"`
}

// toolCallStart tracks an in-flight tool_use awaiting its tool_result.
type toolCallStart struct {
	toolName string
	startMs  float64
}

// toolStats accumulates raw measurements per tool name.
type toolStats struct {
	callCount       uint32
	successCount    uint32
	errorCount      uint32
	durationSamples []float64
	tokenSamples    []uint64
}

// heatmapCellAcc accumulates per-cell heatmap data.
type heatmapCellAcc struct {
	total   uint32
	perTool map[string]uint32
}

// heatmapKey encodes (day, hour) as a single byte: day*24 + hour.
type heatmapKey = uint8

func makeHeatmapKey(day, hour uint8) heatmapKey { return day*24 + hour }
