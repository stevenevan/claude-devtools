package tool_analytics

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"claude-devtools/internal/discovery"
)

// medianU64 returns the median of a sorted-in-place slice. Empty → 0.
// Mirrors aggregator.rs::median_u64.
func medianU64(samples []uint64) uint64 {
	if len(samples) == 0 {
		return 0
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	mid := len(samples) / 2
	if len(samples)%2 == 0 {
		return (samples[mid-1] + samples[mid]) / 2
	}
	return samples[mid]
}

// finalize converts the raw stats map into sorted ToolUsageSummary slice.
// Sorted by call_count descending. Mirrors aggregator.rs::finalize.
func finalize(stats map[string]*toolStats) []ToolUsageSummary {
	out := make([]ToolUsageSummary, 0, len(stats))
	for name, s := range stats {
		avgDuration := 0.0
		if len(s.durationSamples) > 0 {
			sum := 0.0
			for _, d := range s.durationSamples {
				sum += d
			}
			avgDuration = sum / float64(len(s.durationSamples))
		}
		medianTokens := medianU64(s.tokenSamples)
		successRate, errorRate := 0.0, 0.0
		if s.callCount > 0 {
			successRate = float64(s.successCount) / float64(s.callCount)
			errorRate = float64(s.errorCount) / float64(s.callCount)
		}
		out = append(out, ToolUsageSummary{
			ToolName:        name,
			CallCount:       s.callCount,
			SuccessCount:    s.successCount,
			ErrorCount:      s.errorCount,
			SuccessRate:     successRate,
			ErrorRate:       errorRate,
			AvgDurationMs:   avgDuration,
			MedianTokenCost: medianTokens,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CallCount > out[j].CallCount
	})
	return out
}

// resolveProjectDir resolves the project directory path from a project ID.
// Mirrors aggregator.rs::resolve_project_dir.
func resolveProjectDir(projectID string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory")
	}
	claudeDir := home + "/.claude"
	projectsDir := discovery.GetProjectsBasePath(claudeDir)

	baseID := projectID
	if i := strings.Index(projectID, "::"); i >= 0 {
		baseID = projectID[:i]
	}
	dir := projectsDir + "/" + baseID
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("project directory not found: %s", baseID)
	}
	return dir, nil
}

// ComputeToolAnalytics scans sessions in a project and returns per-tool usage
// stats. days is clamped to [1,90]. Mirrors aggregator.rs::compute_tool_analytics.
func ComputeToolAnalytics(projectID string, days uint32) (*ToolAnalyticsResponse, error) {
	projectDir, err := resolveProjectDir(projectID)
	if err != nil {
		return nil, err
	}
	if days < 1 {
		days = 1
	}
	if days > 90 {
		days = 90
	}

	nowMs := float64(time.Now().UnixMilli())
	cutoffMs := nowMs - float64(days)*86_400_000.0

	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}

	stats := make(map[string]*toolStats)
	var scannedSessions uint32

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		modifiedMs := float64(info.ModTime().UnixMilli())
		if modifiedMs < cutoffMs {
			continue
		}
		scannedSessions++
		scanSession(projectDir+"/"+entry.Name(), stats)
	}

	tools := finalize(stats)
	var totalCalls, totalErrors uint32
	for _, t := range tools {
		totalCalls += t.CallCount
		totalErrors += t.ErrorCount
	}

	return &ToolAnalyticsResponse{
		Tools:           tools,
		TotalCalls:      totalCalls,
		TotalErrors:     totalErrors,
		ScannedSessions: scannedSessions,
	}, nil
}

// ComputeToolTimeHeatmap returns a 7×24 heatmap of tool usage bucketed by
// local (weekday, hour). Mirrors aggregator.rs::compute_tool_time_heatmap.
func ComputeToolTimeHeatmap(projectID string, days uint32, toolFilter string) (*ToolTimeHeatmapResponse, error) {
	projectDir, err := resolveProjectDir(projectID)
	if err != nil {
		return nil, err
	}
	if days < 1 {
		days = 1
	}
	if days > 90 {
		days = 90
	}

	nowMs := float64(time.Now().UnixMilli())
	cutoffMs := nowMs - float64(days)*86_400_000.0

	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}

	buckets := make(map[heatmapKey]*heatmapCellAcc)
	// BTreeSet equivalent: use a map then sort keys.
	allToolsSet := make(map[string]struct{})

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		modifiedMs := float64(info.ModTime().UnixMilli())
		if modifiedMs < cutoffMs {
			continue
		}
		fullPath := projectDir + "/" + entry.Name()

		// Collect all tool names regardless of filter.
		unfiltered := make(map[heatmapKey]*heatmapCellAcc)
		scanSessionHeatmap(fullPath, unfiltered, "")
		for _, cell := range unfiltered {
			for name := range cell.perTool {
				allToolsSet[name] = struct{}{}
			}
		}

		// Real scan with filter for bucket totals.
		scanSessionHeatmap(fullPath, buckets, toolFilter)
	}

	// Build ordered 7×24 cells (day 0..6, hour 0..23).
	cells := make([]ToolTimeHeatmapCell, 0, 7*24)
	for day := uint8(0); day < 7; day++ {
		for hour := uint8(0); hour < 24; hour++ {
			key := makeHeatmapKey(day, hour)
			cell := buckets[key]

			var callCount uint32
			var topTool *string
			if cell != nil {
				callCount = cell.total
				// Find top tool deterministically: max count, then alpha on ties.
				var bestName string
				var bestCount uint32
				for name, cnt := range cell.perTool {
					if cnt > bestCount || (cnt == bestCount && name < bestName) {
						bestName = name
						bestCount = cnt
					}
				}
				if bestName != "" {
					s := bestName
					topTool = &s
				}
			}
			cells = append(cells, ToolTimeHeatmapCell{
				DayOfWeek: day,
				Hour:      hour,
				CallCount: callCount,
				TopTool:   topTool,
			})
		}
	}

	var totalCalls uint32
	for _, c := range cells {
		totalCalls += c.CallCount
	}

	// Sort tool names (BTreeSet iteration order = sorted).
	allToolNames := make([]string, 0, len(allToolsSet))
	for name := range allToolsSet {
		allToolNames = append(allToolNames, name)
	}
	sort.Strings(allToolNames)

	return &ToolTimeHeatmapResponse{
		Cells:      cells,
		TotalCalls: totalCalls,
		ToolNames:  allToolNames,
	}, nil
}
