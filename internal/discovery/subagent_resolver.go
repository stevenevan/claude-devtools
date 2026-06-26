package discovery

// Subagent resolver — parse subagent JSONL files, link to Task calls,
// detect parallelism, and propagate team metadata.
// Mirrors src-tauri/src/discovery/subagent_resolver.rs.

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
	"claude-devtools/internal/ptr"
)

const parallelWindowMS = 100.0

// ResolveSubagents returns all subagent Processes for a session.
// Mirrors subagent_resolver::resolve_subagents.
func ResolveSubagents(
	projectsDir, projectID, sessionID string,
	taskCalls []domain.ToolCall,
	messages []domain.ParsedMessage,
) []domain.Process {
	files := listSubagentFiles(projectsDir, projectID, sessionID)
	if len(files) == 0 {
		return []domain.Process{}
	}

	var subagents []domain.Process
	for _, path := range files {
		proc, ok := parseSubagentFile(path)
		if ok {
			subagents = append(subagents, proc)
		}
	}

	if len(subagents) == 0 {
		return []domain.Process{}
	}

	linkToTaskCalls(subagents, taskCalls, messages)
	detectParallelExecution(subagents)

	// Sort by start_time ascending (RFC3339 timestamps sort lexicographically).
	sortProcessesByStartTime(subagents)
	return subagents
}

// listSubagentFiles mirrors subagent_resolver::list_subagent_files — tries the
// new directory layout first, falls back to legacy agent_*.jsonl files.
func listSubagentFiles(projectsDir, projectID, sessionID string) []string {
	baseDir := ExtractBaseDir(projectID)
	var files []string

	// New structure: {projectDir}/{sessionID}/subagents/*.jsonl
	newPath := filepath.Join(projectsDir, baseDir, sessionID, "subagents")
	if info, err := os.Stat(newPath); err == nil && info.IsDir() {
		entries, err := os.ReadDir(newPath)
		if err == nil {
			for _, e := range entries {
				if strings.HasSuffix(e.Name(), ".jsonl") {
					files = append(files, filepath.Join(newPath, e.Name()))
				}
			}
		}
	}

	// Old structure: {projectDir}/agent_*.jsonl (only if new layout had nothing).
	if len(files) == 0 {
		projectDir := filepath.Join(projectsDir, baseDir)
		entries, err := os.ReadDir(projectDir)
		if err == nil {
			for _, e := range entries {
				name := e.Name()
				if strings.HasPrefix(name, "agent_") && strings.HasSuffix(name, ".jsonl") {
					files = append(files, filepath.Join(projectDir, name))
				}
			}
		}
	}

	return files
}

// parseSubagentFile parses one subagent JSONL into a Process.
// Returns (Process, true) or (zero, false) if the file should be skipped.
func parseSubagentFile(filePath string) (domain.Process, bool) {
	messages, _, err := parsing.ParseJSONLFile(filePath)
	if err != nil || len(messages) == 0 {
		return domain.Process{}, false
	}

	if isWarmupSubagent(messages) {
		return domain.Process{}, false
	}

	id := extractAgentID(filePath)
	startTime, endTime, durationMs := calculateSubagentTiming(messages)
	metrics := parsing.CalculateMetrics(messages)

	proc := domain.Process{
		ID:         id,
		FilePath:   filePath,
		StartTime:  startTime,
		EndTime:    endTime,
		DurationMs: durationMs,
		Metrics:    metrics,
		Messages:   messages,
		IsParallel: false,
		// All optional fields left nil to match Rust defaults.
	}
	return proc, true
}

// extractAgentID strips the "agent-" or "agent_" prefix and ".jsonl" suffix.
func extractAgentID(filePath string) string {
	stem := strings.TrimSuffix(filepath.Base(filePath), ".jsonl")
	if rest, ok := strings.CutPrefix(stem, "agent-"); ok {
		return rest
	}
	if rest, ok := strings.CutPrefix(stem, "agent_"); ok {
		return rest
	}
	return stem
}

// isWarmupSubagent returns true when any non-meta user message text is "Warmup".
func isWarmupSubagent(messages []domain.ParsedMessage) bool {
	for _, m := range messages {
		if m.MessageType == "user" && !m.IsMeta {
			if m.Content.Text != nil && strings.TrimSpace(*m.Content.Text) == "Warmup" {
				return true
			}
		}
	}
	return false
}

// calculateSubagentTiming returns (startTime, endTime, durationMs) from messages.
func calculateSubagentTiming(messages []domain.ParsedMessage) (start, end string, durationMs float64) {
	start = messages[0].Timestamp
	end = messages[0].Timestamp
	for _, m := range messages[1:] {
		if m.Timestamp > end {
			end = m.Timestamp
		}
	}
	durationMs = tsDiffMS(end, start)
	return
}

// linkToTaskCalls mirrors subagent_resolver::link_to_task_calls.
func linkToTaskCalls(subagents []domain.Process, taskCalls []domain.ToolCall, messages []domain.ParsedMessage) {
	if len(taskCalls) == 0 {
		return
	}

	// Phase 1: match via toolUseResult.agentId in messages.
	for _, msg := range messages {
		if len(msg.ToolUseResult) == 0 {
			continue
		}
		var tur map[string]json.RawMessage
		if err := json.Unmarshal(msg.ToolUseResult, &tur); err != nil {
			continue
		}
		rawAgentID, ok := tur["agentId"]
		if !ok {
			continue
		}
		var agentID string
		if err := json.Unmarshal(rawAgentID, &agentID); err != nil || agentID == "" {
			continue
		}
		if msg.SourceToolUseID == nil {
			continue
		}
		sourceID := *msg.SourceToolUseID
		for i := range subagents {
			if subagents[i].ID != agentID {
				continue
			}
			subagents[i].ParentTaskID = ptr.To(sourceID)
			for _, tc := range taskCalls {
				if tc.ID == sourceID {
					enrichFromTaskCall(&subagents[i], tc)
					break
				}
			}
			break
		}
	}

	// Phase 2: positional fallback for unlinked subagents.
	linkedIDs := map[string]bool{}
	for _, s := range subagents {
		if s.ParentTaskID != nil {
			linkedIDs[s.ID] = true
		}
	}

	var unmatchedTasks []domain.ToolCall
	for _, tc := range taskCalls {
		matched := false
		for _, s := range subagents {
			if s.ParentTaskID != nil && *s.ParentTaskID == tc.ID {
				matched = true
				break
			}
		}
		if !matched {
			unmatchedTasks = append(unmatchedTasks, tc)
		}
	}

	var unlinkedIdxs []int
	for i, s := range subagents {
		if !linkedIDs[s.ID] {
			unlinkedIdxs = append(unlinkedIdxs, i)
		}
	}

	for i := 0; i < len(unlinkedIdxs) && i < len(unmatchedTasks); i++ {
		idx := unlinkedIdxs[i]
		tc := unmatchedTasks[i]
		subagents[idx].ParentTaskID = ptr.To(tc.ID)
		enrichFromTaskCall(&subagents[idx], tc)
	}
}

func enrichFromTaskCall(proc *domain.Process, tc domain.ToolCall) {
	proc.Description = tc.TaskDescription
	proc.SubagentType = tc.TaskSubagentType
}

// detectParallelExecution mirrors subagent_resolver::detect_parallel_execution.
func detectParallelExecution(subagents []domain.Process) {
	if len(subagents) < 2 {
		return
	}
	starts := make([]string, len(subagents))
	for i, s := range subagents {
		starts[i] = s.StartTime
	}
	for i := range subagents {
		for j := range subagents {
			if i == j {
				continue
			}
			diff := math.Abs(tsDiffMS(starts[i], starts[j]))
			if diff < parallelWindowMS {
				subagents[i].IsParallel = true
				break
			}
		}
	}
}

// sortProcessesByStartTime sorts in-place by StartTime ascending.
func sortProcessesByStartTime(procs []domain.Process) {
	for i := 1; i < len(procs); i++ {
		for j := i; j > 0 && procs[j].StartTime < procs[j-1].StartTime; j-- {
			procs[j], procs[j-1] = procs[j-1], procs[j]
		}
	}
}

// tsDiffMS returns millis(a) - millis(b), treating unparseable timestamps as 0.
func tsDiffMS(a, b string) float64 {
	parse := func(s string) float64 {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return 0
		}
		return float64(t.UnixMilli())
	}
	return parse(a) - parse(b)
}
