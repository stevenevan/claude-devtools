// Per-model aggregated metrics.
package analytics

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"claude-devtools/internal/discovery"
)

// ModelComparisonEntry holds per-model aggregated performance metrics.
type ModelComparisonEntry struct {
	Model                string    `json:"model"`
	DisplayName          string    `json:"displayName"`
	Family               string    `json:"family"`
	SessionCount         uint32    `json:"sessionCount"`
	TotalTokens          uint64    `json:"totalTokens"`
	TotalCostUSD         float64   `json:"totalCostUsd"`
	TokensPerSession     uint64    `json:"tokensPerSession"`
	CostPerSession       float64   `json:"costPerSession"`
	CostPerMillionTokens float64   `json:"costPerMillionTokens"`
	ToolCallsPerSession  float64   `json:"toolCallsPerSession"`
	ErrorRate            float64   `json:"errorRate"`
	AvgResponseMs        float64   `json:"avgResponseMs"`
	DailySessions        []uint32  `json:"dailySessions"`
}

// ModelComparisonResponse is the payload returned by GetModelComparison.
type ModelComparisonResponse struct {
	Models        []ModelComparisonEntry `json:"models"`
	TotalSessions uint32                 `json:"totalSessions"`
}

type modelAccumulator struct {
	sessionCount     uint32
	totalTokens      uint64
	totalCost        float64
	toolCalls        uint64
	toolErrors       uint64
	assistantMessages uint64
	activeMsTotal    float64
	perDay           map[string]uint32
}

// FamilyFor returns the model family: "opus", "sonnet", "haiku", or "other".
// Mirrors model_comparison::family_for.
func FamilyFor(model string) string {
	lower := strings.ToLower(model)
	switch {
	case strings.Contains(lower, "opus"):
		return "opus"
	case strings.Contains(lower, "sonnet"):
		return "sonnet"
	case strings.Contains(lower, "haiku"):
		return "haiku"
	default:
		return "other"
	}
}

func dayKeyFromMs(ms float64) string {
	t := msToTime(ms)
	return fmt.Sprintf("%04d-%02d-%02d", t.Year(), int(t.Month()), t.Day())
}

// ComputeModelComparison aggregates per-model metrics for the last `days` days.
// Mirrors model_comparison::compute_model_comparison.
func ComputeModelComparison(days uint32) (*ModelComparisonResponse, error) {
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

	// Pre-seed 7 most recent day keys for sparklines (consistent length).
	today := msToTime(nowMs).Truncate(24 * time.Hour)
	sparklineKeys := make([]string, 7)
	for i := 6; i >= 0; i-- {
		d := today.AddDate(0, 0, -i)
		sparklineKeys[6-i] = fmt.Sprintf("%04d-%02d-%02d", d.Year(), int(d.Month()), d.Day())
	}

	acc := map[string]*modelAccumulator{}
	totalSessions := uint32(0)
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
			if modifiedMs < cutoffMs {
				continue
			}

			summary := ScanSessionFast(projectDir + "/" + name)
			if summary == nil || summary.Model == nil {
				continue
			}
			model := *summary.Model

			totalSessions++
			tokens := summary.InputTokens + summary.OutputTokens +
				summary.CacheReadTokens + summary.CacheCreationTokens
			cost := EstimateCost(model, summary.InputTokens, summary.OutputTokens,
				summary.CacheReadTokens, summary.CacheCreationTokens)

			if _, ok := acc[model]; !ok {
				acc[model] = &modelAccumulator{perDay: map[string]uint32{}}
			}
			a := acc[model]
			a.sessionCount++
			a.totalTokens += tokens
			a.totalCost += cost
			a.toolCalls += summary.ToolCallCount
			a.toolErrors += summary.ToolErrorCount
			a.assistantMessages += summary.AssistantMessageCount
			a.activeMsTotal += summary.ActiveMs

			startMs := modifiedMs
			if summary.FirstTimestampMs != nil {
				startMs = *summary.FirstTimestampMs
			}
			a.perDay[dayKeyFromMs(startMs)]++
		}
	}

	models := make([]ModelComparisonEntry, 0, len(acc))
	for model, a := range acc {
		tokensPerSession := uint64(0)
		if a.sessionCount > 0 {
			tokensPerSession = a.totalTokens / uint64(a.sessionCount)
		}
		costPerSession := 0.0
		if a.sessionCount > 0 {
			costPerSession = a.totalCost / float64(a.sessionCount)
		}
		costPerMillion := 0.0
		if a.totalTokens > 0 {
			costPerMillion = (a.totalCost / float64(a.totalTokens)) * 1_000_000.0
		}
		toolCallsPerSession := 0.0
		if a.sessionCount > 0 {
			toolCallsPerSession = float64(a.toolCalls) / float64(a.sessionCount)
		}
		errorRate := 0.0
		if a.toolCalls > 0 {
			errorRate = float64(a.toolErrors) / float64(a.toolCalls)
		}
		avgResponseMs := 0.0
		if a.assistantMessages > 0 {
			avgResponseMs = a.activeMsTotal / float64(a.assistantMessages)
		}
		dailySessions := make([]uint32, len(sparklineKeys))
		for i, k := range sparklineKeys {
			dailySessions[i] = a.perDay[k]
		}

		models = append(models, ModelComparisonEntry{
			Model:                model,
			DisplayName:          ModelDisplayName(model),
			Family:               FamilyFor(model),
			SessionCount:         a.sessionCount,
			TotalTokens:          a.totalTokens,
			TotalCostUSD:         a.totalCost,
			TokensPerSession:     tokensPerSession,
			CostPerSession:       costPerSession,
			CostPerMillionTokens: costPerMillion,
			ToolCallsPerSession:  toolCallsPerSession,
			ErrorRate:            errorRate,
			AvgResponseMs:        avgResponseMs,
			DailySessions:        dailySessions,
		})
	}

	// Sort by session count descending, then model name for determinism.
	sort.Slice(models, func(i, j int) bool {
		if models[i].SessionCount != models[j].SessionCount {
			return models[i].SessionCount > models[j].SessionCount
		}
		return models[i].Model < models[j].Model
	})

	return &ModelComparisonResponse{
		Models:        models,
		TotalSessions: totalSessions,
	}, nil
}
