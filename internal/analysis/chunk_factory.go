package analysis

import (
	"regexp"
	"sort"

	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
)

func metricsOf(m domain.ParsedMessage) domain.SessionMetrics {
	return parsing.CalculateMetrics([]domain.ParsedMessage{m})
}

func buildUserChunk(m *domain.ParsedMessage) domain.EnhancedChunk {
	return domain.EnhancedChunk{Type: "user", User: &domain.EnhancedUserChunk{
		ID: "user-" + m.UUID, StartTime: m.Timestamp, EndTime: m.Timestamp, DurationMs: 0,
		Metrics: metricsOf(*m), UserMessage: *m, RawMessages: []domain.ParsedMessage{*m},
	}}
}

func buildSystemChunk(m *domain.ParsedMessage) domain.EnhancedChunk {
	return domain.EnhancedChunk{Type: "system", System: &domain.EnhancedSystemChunk{
		ID: "system-" + m.UUID, StartTime: m.Timestamp, EndTime: m.Timestamp, DurationMs: 0,
		Metrics: metricsOf(*m), Message: *m, CommandOutput: extractCommandOutput(m),
		RawMessages: []domain.ParsedMessage{*m},
	}}
}

func buildCompactChunk(m *domain.ParsedMessage) domain.EnhancedChunk {
	return domain.EnhancedChunk{Type: "compact", Compact: &domain.EnhancedCompactChunk{
		ID: "compact-" + m.UUID, StartTime: m.Timestamp, EndTime: m.Timestamp, DurationMs: 0,
		Metrics: metricsOf(*m), Message: *m, RawMessages: []domain.ParsedMessage{*m},
	}}
}

func buildEventChunk(m *domain.ParsedMessage) domain.EnhancedChunk {
	ed := domain.SystemEventData{Subtype: derefStr(m.Subtype)}
	if m.EventData != nil {
		ed = *m.EventData
	}
	return domain.EnhancedChunk{Type: "event", Event: &domain.EnhancedEventChunk{
		ID: "event-" + m.UUID, StartTime: m.Timestamp, EndTime: m.Timestamp, DurationMs: 0,
		Metrics: metricsOf(*m), Message: *m, EventData: ed, RawMessages: []domain.ParsedMessage{*m},
	}}
}

var stdoutRe = regexp.MustCompile(`(?s)<local-command-stdout>(.*?)</local-command-stdout>`)
var stderrRe = regexp.MustCompile(`(?s)<local-command-stderr>(.*?)</local-command-stderr>`)

func extractCommandOutput(m *domain.ParsedMessage) string {
	content := ""
	if m.Content.Text != nil {
		content = *m.Content.Text
	}
	if c := stdoutRe.FindStringSubmatch(content); c != nil {
		return c[1]
	}
	if c := stderrRe.FindStringSubmatch(content); c != nil {
		return c[1]
	}
	return content
}

func buildAIChunkFromBuffer(responses []domain.ParsedMessage, subagents []domain.Process, all []domain.ParsedMessage, pc *uint32, pt *[]string) domain.EnhancedChunk {
	id := "ai-empty"
	if len(responses) > 0 {
		id = "ai-" + responses[0].UUID
	}
	startTime, endTime, durationMs := calculateAITiming(responses)
	processes := linkProcessesToAIChunk(responses, startTime, endTime, subagents)
	steps := extractSemanticSteps(responses, processes)
	fillTimelineGaps(steps, endTime)
	calculateStepContext(steps, responses)
	groups := buildSemanticStepGroups(steps)

	return domain.EnhancedChunk{Type: "ai", Ai: &domain.EnhancedAIChunk{
		ID:                 id,
		StartTime:          startTime,
		EndTime:            endTime,
		DurationMs:         durationMs,
		Metrics:            parsing.CalculateMetrics(responses),
		Responses:          responses,
		Processes:          processes,
		SidechainMessages:  collectSidechainMessages(all, startTime, endTime),
		ToolExecutions:     buildToolExecutions(responses),
		SemanticSteps:      steps,
		SemanticStepGroups: &groups,
		RawMessages:        responses,
		ProgressCount:      pc,
		ProgressTexts:      pt,
	}}
}

func calculateAITiming(responses []domain.ParsedMessage) (string, string, float64) {
	if len(responses) == 0 {
		return "", "", 0
	}
	start := responses[0].Timestamp
	end := start
	for _, r := range responses {
		if r.Timestamp > end {
			end = r.Timestamp
		}
	}
	d := timestampDiffMs(end, start)
	if d < 0 {
		d = 0
	}
	return start, end, d
}

func collectSidechainMessages(messages []domain.ParsedMessage, start, end string) []domain.ParsedMessage {
	out := []domain.ParsedMessage{}
	for _, m := range messages {
		if m.IsSidechain && m.Timestamp >= start && m.Timestamp < end {
			out = append(out, m)
		}
	}
	return out
}

// buildToolExecutions mirrors tool_execution_builder::build_tool_executions.
func buildToolExecutions(messages []domain.ParsedMessage) []domain.ToolExecution {
	type callEntry struct {
		call  domain.ToolCall
		start string
	}
	callMap := map[string]callEntry{}
	for _, msg := range messages {
		for _, tc := range msg.ToolCalls {
			callMap[tc.ID] = callEntry{tc, msg.Timestamp}
		}
	}

	execs := []domain.ToolExecution{}
	for _, msg := range messages {
		if msg.SourceToolUseID != nil {
			if ce, ok := callMap[*msg.SourceToolUseID]; ok && len(msg.ToolResults) > 0 {
				res := msg.ToolResults[0]
				execs = append(execs, domain.ToolExecution{
					ToolCall: ce.call, Result: &res, StartTime: ce.start,
					EndTime: ptrStr(msg.Timestamp), DurationMs: ptrF64(maxF(timestampDiffMs(msg.Timestamp, ce.start), 0)),
				})
			}
		}
		for i := range msg.ToolResults {
			result := msg.ToolResults[i]
			already := false
			for _, e := range execs {
				if e.Result != nil && e.Result.ToolUseID == result.ToolUseID {
					already = true
					break
				}
			}
			if already {
				continue
			}
			if ce, ok := callMap[result.ToolUseID]; ok {
				execs = append(execs, domain.ToolExecution{
					ToolCall: ce.call, Result: &result, StartTime: ce.start,
					EndTime: ptrStr(msg.Timestamp), DurationMs: ptrF64(maxF(timestampDiffMs(msg.Timestamp, ce.start), 0)),
				})
			}
		}
	}

	for id, ce := range callMap {
		found := false
		for _, e := range execs {
			if e.ToolCall.ID == id {
				found = true
				break
			}
		}
		if !found {
			execs = append(execs, domain.ToolExecution{ToolCall: ce.call, StartTime: ce.start})
		}
	}

	sort.SliceStable(execs, func(i, j int) bool { return execs[i].StartTime < execs[j].StartTime })
	return execs
}

// linkProcessesToAIChunk mirrors process_linker::link_processes_to_ai_chunk.
func linkProcessesToAIChunk(responses []domain.ParsedMessage, chunkStart, chunkEnd string, subagents []domain.Process) []domain.Process {
	taskIDs := map[string]bool{}
	for _, r := range responses {
		for _, tc := range r.ToolCalls {
			if tc.IsTask {
				taskIDs[tc.ID] = true
			}
		}
	}
	linked := []domain.Process{}
	linkedIDs := map[string]bool{}
	for _, sub := range subagents {
		if sub.ParentTaskID != nil && taskIDs[*sub.ParentTaskID] {
			linked = append(linked, sub)
			linkedIDs[sub.ID] = true
		}
	}
	for _, sub := range subagents {
		if linkedIDs[sub.ID] || sub.ParentTaskID != nil {
			continue
		}
		if sub.StartTime >= chunkStart && sub.StartTime <= chunkEnd {
			linked = append(linked, sub)
		}
	}
	sort.SliceStable(linked, func(i, j int) bool { return linked[i].StartTime < linked[j].StartTime })
	return linked
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
