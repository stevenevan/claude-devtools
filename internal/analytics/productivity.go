// Productivity metrics — mirrors src-tauri/src/analytics/productivity.rs.
package analytics

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"claude-devtools/internal/discovery"
)

// ProductivityDay holds per-day KPIs.
type ProductivityDay struct {
	Date               string  `json:"date"`
	SessionsStarted    uint32  `json:"sessionsStarted"`
	SessionsCompleted  uint32  `json:"sessionsCompleted"`
	ActiveMs           float64 `json:"activeMs"`
	ToolCalls          uint64  `json:"toolCalls"`
	TokensP50          uint64  `json:"tokensP50"`
	TokensP95          uint64  `json:"tokensP95"`
}

// ProductivityTotals holds aggregated KPIs across all days.
type ProductivityTotals struct {
	SessionsStarted   uint32  `json:"sessionsStarted"`
	SessionsCompleted uint32  `json:"sessionsCompleted"`
	ActiveMs          float64 `json:"activeMs"`
	ToolCalls         uint64  `json:"toolCalls"`
	TokensP50         uint64  `json:"tokensP50"`
	TokensP95         uint64  `json:"tokensP95"`
}

// ProductivityMetrics is the payload returned by GetProductivityMetrics.
type ProductivityMetrics struct {
	Days   []ProductivityDay  `json:"days"`
	Totals ProductivityTotals `json:"totals"`
}

// PercentileU64 returns the p-th percentile of a sorted ascending uint64 slice.
// Empty → 0. Mirrors productivity::percentile_u64.
func PercentileU64(sorted []uint64, pct float64) uint64 {
	if len(sorted) == 0 {
		return 0
	}
	if pct < 0.0 {
		pct = 0.0
	}
	if pct > 1.0 {
		pct = 1.0
	}
	idx := int((float64(len(sorted)-1)*pct)+0.5) // round
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

type dayAccumulator struct {
	sessionsStarted   uint32
	sessionsCompleted uint32
	activeMs          float64
	toolCalls         uint64
	tokens            []uint64
}

func dayKeyMs(ms float64) string {
	t := msToTime(ms)
	return fmt.Sprintf("%04d-%02d-%02d", t.Year(), int(t.Month()), t.Day())
}

// ComputeProductivityMetrics returns per-day productivity KPIs for the last `days` days.
// Mirrors productivity::compute_productivity_metrics.
func ComputeProductivityMetrics(days uint32) (*ProductivityMetrics, error) {
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

	// Seed empty day buckets for the full range (oldest → newest).
	today := msToTime(nowMs).Truncate(24 * time.Hour)
	orderedKeys := make([]string, 0, days)
	dayBuckets := map[string]*dayAccumulator{}
	for i := int(days) - 1; i >= 0; i-- {
		d := today.AddDate(0, 0, -i)
		key := fmt.Sprintf("%04d-%02d-%02d", d.Year(), int(d.Month()), d.Day())
		orderedKeys = append(orderedKeys, key)
		dayBuckets[key] = &dayAccumulator{}
	}

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

			fi, err := entry.Info()
			if err != nil {
				continue
			}
			modifiedMs := float64(fi.ModTime().UnixMilli())
			createdMs := modifiedMs // no portable birthtime in Go; use mtime

			latest := modifiedMs
			if createdMs > latest {
				latest = createdMs
			}
			if latest < cutoffMs {
				continue
			}

			summary := ScanSessionFast(projectDir + "/" + name)
			if summary == nil {
				continue
			}

			startMs := createdMs
			if summary.FirstTimestampMs != nil {
				startMs = *summary.FirstTimestampMs
			}
			endMs := latest
			if summary.LastTimestampMs != nil {
				endMs = *summary.LastTimestampMs
			}

			tokens := summary.InputTokens + summary.OutputTokens +
				summary.CacheReadTokens + summary.CacheCreationTokens

			startedKey := dayKeyMs(startMs)
			if bucket, ok := dayBuckets[startedKey]; ok {
				bucket.sessionsStarted++
				bucket.activeMs += summary.ActiveMs
				bucket.toolCalls += summary.ToolCallCount
				bucket.tokens = append(bucket.tokens, tokens)
			}

			if summary.DurationMs > 0.0 {
				completedKey := dayKeyMs(endMs)
				if bucket, ok := dayBuckets[completedKey]; ok {
					bucket.sessionsCompleted++
				}
			}
		}
	}

	daysOut := make([]ProductivityDay, 0, len(orderedKeys))
	var allTokens []uint64
	totals := ProductivityTotals{}

	for _, key := range orderedKeys {
		bucket := dayBuckets[key]
		sorted := make([]uint64, len(bucket.tokens))
		copy(sorted, bucket.tokens)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
		p50 := PercentileU64(sorted, 0.5)
		p95 := PercentileU64(sorted, 0.95)

		totals.SessionsStarted += bucket.sessionsStarted
		totals.SessionsCompleted += bucket.sessionsCompleted
		totals.ActiveMs += bucket.activeMs
		totals.ToolCalls += bucket.toolCalls
		allTokens = append(allTokens, sorted...)

		daysOut = append(daysOut, ProductivityDay{
			Date:              key,
			SessionsStarted:   bucket.sessionsStarted,
			SessionsCompleted: bucket.sessionsCompleted,
			ActiveMs:          bucket.activeMs,
			ToolCalls:         bucket.toolCalls,
			TokensP50:         p50,
			TokensP95:         p95,
		})
	}

	sort.Slice(allTokens, func(i, j int) bool { return allTokens[i] < allTokens[j] })
	totals.TokensP50 = PercentileU64(allTokens, 0.5)
	totals.TokensP95 = PercentileU64(allTokens, 0.95)

	return &ProductivityMetrics{
		Days:   daysOut,
		Totals: totals,
	}, nil
}
