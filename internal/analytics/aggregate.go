// Main analytics aggregation.
// Walks project sessions, buckets by time, computes totals.
package analytics

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"claude-devtools/internal/discovery"
)

// ComputeAnalytics scans all projects and returns aggregated usage metrics.
// days is clamped to [1, 90]. Mirrors aggregate::compute_analytics.
func ComputeAnalytics(days uint32) (*AnalyticsResponse, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("cannot resolve home directory: %w", err)
	}
	claudeDir := home + "/.claude"
	projectsDir := discovery.GetProjectsBasePath(claudeDir)

	if days < 1 {
		days = 1
	}
	if days > 90 {
		days = 90
	}
	granularity := GranularityForDays(days)

	registry := discovery.NewSubprojectRegistry()
	projects, err := discovery.ScanProjects(projectsDir, registry)
	if err != nil {
		return nil, fmt.Errorf("scan projects: %w", err)
	}

	nowMs := float64(time.Now().UnixMilli())
	cutoffMs := nowMs - float64(days)*86_400_000.0

	// Build ordered empty buckets and a key→index map.
	buckets, bucketIndex := buildEmptyBuckets(granularity, days, nowMs)

	// Aggregation maps: name → (tokens, cost, count).
	type agg struct {
		tokens uint64
		cost   float64
		count  uint32
	}
	projectAgg := map[string]*agg{}
	modelAgg := map[string]*agg{}
	var scheduleEvents []ScheduleEventEntry
	var topSessions []TopSessionEntry
	var totalTokens uint64
	var totalCost float64
	var totalSessions uint32

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
			createdMs := modifiedMs // Go has no portable birthtime; use mtime as created.

			latestActivity := modifiedMs
			if createdMs > latestActivity {
				latestActivity = createdMs
			}
			if latestActivity < cutoffMs {
				continue
			}

			summary := ScanSessionFast(projectDir + "/" + name)
			if summary == nil {
				continue
			}

			sessionTimestamp := latestActivity
			if summary.LastTimestampMs != nil {
				sessionTimestamp = *summary.LastTimestampMs
			}

			tokTotal := summary.InputTokens + summary.OutputTokens +
				summary.CacheReadTokens + summary.CacheCreationTokens
			modelStr := ""
			if summary.Model != nil {
				modelStr = *summary.Model
			}
			cost := EstimateCost(modelStr, summary.InputTokens, summary.OutputTokens,
				summary.CacheReadTokens, summary.CacheCreationTokens)

			bkey := BucketKeyFor(granularity, sessionTimestamp)
			if idx, ok := bucketIndex[bkey]; ok {
				b := &buckets[idx]
				b.TotalTokens += tokTotal
				b.InputTokens += summary.InputTokens
				b.OutputTokens += summary.OutputTokens
				b.CacheReadTokens += summary.CacheReadTokens
				b.CostUSD += cost
				b.SessionCount++
			}

			if _, ok := projectAgg[project.Name]; !ok {
				projectAgg[project.Name] = &agg{}
			}
			projectAgg[project.Name].tokens += tokTotal
			projectAgg[project.Name].cost += cost
			projectAgg[project.Name].count++

			if modelStr != "" {
				if _, ok := modelAgg[modelStr]; !ok {
					modelAgg[modelStr] = &agg{}
				}
				modelAgg[modelStr].tokens += tokTotal
				modelAgg[modelStr].cost += cost
				modelAgg[modelStr].count++
			}

			sessionStart := createdMs
			if summary.FirstTimestampMs != nil {
				sessionStart = *summary.FirstTimestampMs
			}

			if summary.DurationMs > 0.0 {
				title := "Untitled session"
				if summary.CustomTitle != nil {
					title = *summary.CustomTitle
				} else if summary.FirstUserText != nil {
					title = *summary.FirstUserText
				}

				scheduleEvents = append(scheduleEvents, ScheduleEventEntry{
					ID:           sessionID,
					ProjectName:  project.Name,
					SessionTitle: title,
					StartTime:    sessionStart,
					EndTime:      sessionStart + summary.DurationMs,
					ProjectID:    baseID,
				})

				modelPtr := summary.Model
				topSessions = append(topSessions, TopSessionEntry{
					ProjectName: project.Name,
					Title:       title,
					TotalTokens: tokTotal,
					CostUSD:     cost,
					DurationMs:  summary.DurationMs,
					Model:       modelPtr,
				})
			}

			totalTokens += tokTotal
			totalCost += cost
			totalSessions++
		}
	}

	// Sort schedule events by start time ascending.
	sort.Slice(scheduleEvents, func(i, j int) bool {
		return scheduleEvents[i].StartTime < scheduleEvents[j].StartTime
	})

	// Top sessions: descending by tokens, keep top 8.
	sort.Slice(topSessions, func(i, j int) bool {
		return topSessions[i].TotalTokens > topSessions[j].TotalTokens
	})
	if len(topSessions) > 8 {
		topSessions = topSessions[:8]
	}

	projectUsage := make([]ProjectUsageEntry, 0, len(projectAgg))
	for name, a := range projectAgg {
		projectUsage = append(projectUsage, ProjectUsageEntry{
			ProjectName:  name,
			TotalTokens:  a.tokens,
			CostUSD:      a.cost,
			SessionCount: a.count,
		})
	}
	sort.Slice(projectUsage, func(i, j int) bool {
		if projectUsage[i].TotalTokens != projectUsage[j].TotalTokens {
			return projectUsage[i].TotalTokens > projectUsage[j].TotalTokens
		}
		return projectUsage[i].ProjectName < projectUsage[j].ProjectName
	})

	modelUsage := make([]ModelUsageEntry, 0, len(modelAgg))
	for model, a := range modelAgg {
		modelUsage = append(modelUsage, ModelUsageEntry{
			Model:        model,
			DisplayName:  ModelDisplayName(model),
			TotalTokens:  a.tokens,
			CostUSD:      a.cost,
			SessionCount: a.count,
		})
	}
	sort.Slice(modelUsage, func(i, j int) bool {
		if modelUsage[i].TotalTokens != modelUsage[j].TotalTokens {
			return modelUsage[i].TotalTokens > modelUsage[j].TotalTokens
		}
		return modelUsage[i].Model < modelUsage[j].Model
	})

	avgTokens := uint64(0)
	avgCost := 0.0
	if totalSessions > 0 {
		avgTokens = totalTokens / uint64(totalSessions)
		avgCost = totalCost / float64(totalSessions)
	}

	// Nil-guard slices that the frontend iterates.
	if scheduleEvents == nil {
		scheduleEvents = []ScheduleEventEntry{}
	}
	if topSessions == nil {
		topSessions = []TopSessionEntry{}
	}

	return &AnalyticsResponse{
		TimeBuckets:         buckets,
		ProjectUsage:        projectUsage,
		ModelUsage:          modelUsage,
		ScheduleEvents:      scheduleEvents,
		TopSessions:         topSessions,
		TotalTokens:         totalTokens,
		TotalCost:           totalCost,
		TotalSessions:       totalSessions,
		AvgTokensPerSession: avgTokens,
		AvgCostPerSession:   avgCost,
		Granularity:         granularity,
		ToolSummary:         nil,
	}, nil
}

// buildEmptyBuckets builds the ordered bucket slice and a key→index map.
// Mirrors aggregate::build_empty_buckets.
func buildEmptyBuckets(g BucketGranularity, days uint32, nowMs float64) ([]TimeBucketUsage, map[string]int) {
	var pairs []struct {
		key    string
		bucket TimeBucketUsage
	}

	now := msToTime(nowMs)
	today := now.Truncate(24 * time.Hour)

	switch g {
	case GranularityHourly:
		showDate := days > 1
		for d := int(days) - 1; d >= 0; d-- {
			date := today.AddDate(0, 0, -d)
			for h := 0; h < 24; h++ {
				key := fmt.Sprintf("%04d-%02d-%02d-%02d",
					date.Year(), int(date.Month()), date.Day(), h)
				var label string
				if showDate {
					label = fmt.Sprintf("%s %d %s",
						date.Format("Jan"), date.Day(), HourLabel(h))
				} else {
					label = HourLabel(h)
				}
				pairs = append(pairs, struct {
					key    string
					bucket TimeBucketUsage
				}{key, MakeEmptyBucket(key, label)})
			}
		}

	case GranularityDaily:
		for i := int(days) - 1; i >= 0; i-- {
			t := msToTime(nowMs - float64(i)*86_400_000.0)
			key := fmt.Sprintf("%04d-%02d-%02d", t.Year(), int(t.Month()), t.Day())
			pairs = append(pairs, struct {
				key    string
				bucket TimeBucketUsage
			}{key, MakeEmptyBucket(key, DayLabel(t))})
		}

	case GranularityWeekly:
		startDate := today.AddDate(0, 0, -int(days)+1)
		monday := isoMonday(startDate)
		for !monday.After(today) {
			y, w := monday.ISOWeek()
			key := fmt.Sprintf("%04d-W%02d", y, w)
			pairs = append(pairs, struct {
				key    string
				bucket TimeBucketUsage
			}{key, MakeEmptyBucket(key, WeekLabel(monday))})
			monday = monday.AddDate(0, 0, 7)
		}

	case GranularityMonthly:
		startDate := today.AddDate(0, 0, -int(days)+1)
		cursor := time.Date(startDate.Year(), startDate.Month(), 1, 0, 0, 0, 0, time.UTC)
		endMonth := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
		for !cursor.After(endMonth) {
			key := fmt.Sprintf("%04d-%02d", cursor.Year(), int(cursor.Month()))
			label := MonthLabel(cursor.Year(), cursor.Month())
			pairs = append(pairs, struct {
				key    string
				bucket TimeBucketUsage
			}{key, MakeEmptyBucket(key, label)})
			cursor = cursor.AddDate(0, 1, 0)
		}
	}

	buckets := make([]TimeBucketUsage, len(pairs))
	index := make(map[string]int, len(pairs))
	for i, p := range pairs {
		buckets[i] = p.bucket
		index[p.key] = i
	}
	return buckets, index
}
