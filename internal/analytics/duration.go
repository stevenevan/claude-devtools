// Per-session duration analytics — mirrors src-tauri/src/analytics/duration.rs.
package analytics

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"claude-devtools/internal/discovery"
)

// OutlierFactor is the multiplier above p95 that marks a session as an outlier.
// Mirrors duration::OUTLIER_FACTOR.
const OutlierFactor = 1.5

// SessionDurationEntry holds wall-clock and active durations for one session.
type SessionDurationEntry struct {
	SessionID   string  `json:"sessionId"`
	ProjectID   string  `json:"projectId"`
	ProjectName string  `json:"projectName"`
	Title       string  `json:"title"`
	WallMs      float64 `json:"wallMs"`
	ActiveMs    float64 `json:"activeMs"`
	StartedMs   float64 `json:"startedMs"`
}

// DurationStats holds p50/p95/max aggregates.
type DurationStats struct {
	P50Ms              float64 `json:"p50Ms"`
	P95Ms              float64 `json:"p95Ms"`
	MaxMs              float64 `json:"maxMs"`
	OutlierThresholdMs float64 `json:"outlierThresholdMs"`
}

// SessionDurationResponse is the payload returned by GetSessionDurationStats.
type SessionDurationResponse struct {
	Sessions          []SessionDurationEntry `json:"sessions"`
	Histogram         []uint32               `json:"histogram"`
	HistogramMaxMs    float64                `json:"histogramMaxMs"`
	WallStats         DurationStats          `json:"wallStats"`
	ActiveStats       DurationStats          `json:"activeStats"`
	OutlierSessionIDs []string               `json:"outlierSessionIds"`
}

// Percentile returns the p-th percentile of a sorted ascending float64 slice.
// Empty slice returns 0. Mirrors duration::percentile.
func Percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0.0
	}
	if p < 0.0 {
		p = 0.0
	}
	if p > 1.0 {
		p = 1.0
	}
	idx := int((float64(len(sorted)-1) * p) + 0.5) // round
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func computeDurationStats(sorted []float64) DurationStats {
	p50 := Percentile(sorted, 0.5)
	p95 := Percentile(sorted, 0.95)
	max := 0.0
	if len(sorted) > 0 {
		max = sorted[len(sorted)-1]
	}
	return DurationStats{
		P50Ms:              p50,
		P95Ms:              p95,
		MaxMs:              max,
		OutlierThresholdMs: p95 * OutlierFactor,
	}
}

func buildHistogram(values []float64, maxMs float64, bucketCount int) []uint32 {
	if bucketCount == 0 {
		bucketCount = 1
	}
	buckets := make([]uint32, bucketCount)
	if maxMs <= 0.0 {
		return buckets
	}
	bucketWidth := maxMs / float64(bucketCount)
	for _, v := range values {
		if v <= 0.0 {
			buckets[0]++
			continue
		}
		idx := int(v / bucketWidth)
		if idx >= bucketCount {
			idx = bucketCount - 1
		}
		buckets[idx]++
	}
	return buckets
}

// ComputeSessionDurationStats returns duration analytics for the last `days` days.
// Mirrors duration::compute_session_duration_stats.
func ComputeSessionDurationStats(days uint32) (*SessionDurationResponse, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("cannot resolve home directory: %w", err)
	}
	projectsDir := discovery.GetProjectsBasePath(home + "/.claude")

	if days < 1 {
		days = 1
	}
	if days > 90 {
		days = 90
	}

	registry := discovery.NewSubprojectRegistry()
	projects, err := discovery.ScanProjects(projectsDir, registry)
	if err != nil {
		return nil, fmt.Errorf("scan projects: %w", err)
	}

	nowMs := float64(time.Now().UnixMilli())
	cutoffMs := nowMs - float64(days)*86_400_000.0

	var sessions []SessionDurationEntry
	seenDirs := map[string]struct{}{}

	for _, project := range projects {
		baseID := discovery.ExtractBaseDir(project.ID)
		if _, ok := seenDirs[baseID]; ok {
			continue
		}
		seenDirs[baseID] = struct{}{}

		projectDir := projectsDir + "/" + baseID
		info, err := os.Stat(projectDir)
		if err != nil || !info.IsDir() {
			continue
		}

		entries, err := os.ReadDir(projectDir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() || !strings.HasSuffix(name, ".jsonl") {
				continue
			}
			sessionID := strings.TrimSuffix(name, ".jsonl")

			fi, err := entry.Info()
			if err != nil {
				continue
			}
			modifiedMs := float64(fi.ModTime().UnixMilli())
			if modifiedMs < cutoffMs {
				continue
			}

			summary := ScanSessionFast(projectDir + "/" + name)
			if summary == nil {
				continue
			}
			if summary.DurationMs <= 0.0 && summary.ActiveMs <= 0.0 {
				continue
			}

			title := "Untitled session"
			if summary.CustomTitle != nil {
				title = *summary.CustomTitle
			} else if summary.FirstUserText != nil {
				title = *summary.FirstUserText
			}
			startedMs := modifiedMs
			if summary.FirstTimestampMs != nil {
				startedMs = *summary.FirstTimestampMs
			}

			sessions = append(sessions, SessionDurationEntry{
				SessionID:   sessionID,
				ProjectID:   baseID,
				ProjectName: project.Name,
				Title:       title,
				WallMs:      summary.DurationMs,
				ActiveMs:    summary.ActiveMs,
				StartedMs:   startedMs,
			})
		}
	}

	wallSorted := make([]float64, len(sessions))
	for i, s := range sessions {
		wallSorted[i] = s.WallMs
	}
	sort.Float64s(wallSorted)

	activeSorted := make([]float64, len(sessions))
	for i, s := range sessions {
		activeSorted[i] = s.ActiveMs
	}
	sort.Float64s(activeSorted)

	wallStats := computeDurationStats(wallSorted)
	activeStats := computeDurationStats(activeSorted)

	histogramMaxMs := wallStats.MaxMs
	if histogramMaxMs <= 0.0 {
		histogramMaxMs = 1.0
	}
	histogram := buildHistogram(wallSorted, histogramMaxMs, 12)

	outlierThreshold := wallStats.OutlierThresholdMs
	outlierIDs := []string{}
	for _, s := range sessions {
		if outlierThreshold > 0.0 && s.WallMs > outlierThreshold {
			outlierIDs = append(outlierIDs, s.SessionID)
		}
	}
	sort.Strings(outlierIDs)

	// Most-recent first so the panel's outlier list reads chronologically.
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedMs > sessions[j].StartedMs
	})

	if sessions == nil {
		sessions = []SessionDurationEntry{}
	}

	return &SessionDurationResponse{
		Sessions:          sessions,
		Histogram:         histogram,
		HistogramMaxMs:    histogramMaxMs,
		WallStats:         wallStats,
		ActiveStats:       activeStats,
		OutlierSessionIDs: outlierIDs,
	}, nil
}
