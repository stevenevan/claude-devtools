package analysis

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"claude-devtools/internal/domain"
)

// extractSemanticSteps mirrors semantic_step_extractor::extract_semantic_steps.
func extractSemanticSteps(responses []domain.ParsedMessage, processes []domain.Process) []domain.SemanticStep {
	steps := []domain.SemanticStep{}
	var counter uint32

	for ri := range responses {
		msg := responses[ri]

		if msg.MessageType == "assistant" && msg.Content.Text == nil {
			for _, b := range msg.Content.Blocks {
				switch b.Type {
				case "thinking":
					thinking := derefStr(b.Thinking)
					tokens := countTokens(thinking)
					steps = append(steps, domain.SemanticStep{
						ID: msg.UUID + "-thinking-" + u32(counter), StepType: "thinking",
						StartTime: msg.Timestamp, Context: contextFor(msg), AgentID: msg.AgentID,
						SourceMessageID: ptrStr(msg.UUID),
						Content:         domain.SemanticStepContent{ThinkingText: ptrStr(thinking), TokenCount: ptrU64(tokens)},
						Tokens:          &domain.SemanticStepTokens{Input: 0, Output: tokens},
					})
					counter++
				case "tool_use":
					name := derefStr(b.Name)
					callStr := name + compactSortedJSON(b.Input)
					tokens := countTokens(callStr)
					steps = append(steps, domain.SemanticStep{
						ID: derefStr(b.ID), StepType: "tool_call",
						StartTime: msg.Timestamp, Context: contextFor(msg), AgentID: msg.AgentID,
						SourceMessageID: ptrStr(msg.UUID),
						Content:         domain.SemanticStepContent{ToolName: ptrStr(name), ToolInput: b.Input, SourceModel: msg.Model},
						Tokens:          &domain.SemanticStepTokens{Input: tokens, Output: 0},
					})
				case "text":
					text := derefStr(b.Text)
					if text == "" {
						continue
					}
					tokens := countTokens(text)
					steps = append(steps, domain.SemanticStep{
						ID: msg.UUID + "-output-" + u32(counter), StepType: "output",
						StartTime: msg.Timestamp, Context: contextFor(msg), AgentID: msg.AgentID,
						SourceMessageID: ptrStr(msg.UUID),
						Content:         domain.SemanticStepContent{OutputText: ptrStr(text), TokenCount: ptrU64(tokens)},
						Tokens:          &domain.SemanticStepTokens{Input: 0, Output: tokens},
					})
					counter++
				}
			}
		}

		if msg.MessageType == "user" && len(msg.ToolResults) > 0 {
			for _, result := range msg.ToolResults {
				contentStr := toolResultContentStr(result.Content)
				tokens := countTokens(contentStr)
				steps = append(steps, domain.SemanticStep{
					ID: result.ToolUseID, StepType: "tool_result",
					StartTime: msg.Timestamp, Context: contextFor(msg), AgentID: msg.AgentID,
					Content: domain.SemanticStepContent{
						ToolResultContent: ptrStr(contentStr), IsError: ptrBool(result.IsError),
						ToolUseResult: msg.ToolUseResult, TokenCount: ptrU64(tokens),
					},
				})
			}
		}

		if msg.MessageType == "user" {
			for _, b := range msg.Content.Blocks {
				if b.Type == "text" {
					text := derefStr(b.Text)
					if strings.Contains(text, "[Request interrupted by user]") ||
						strings.Contains(text, "[Request interrupted by user for tool use]") {
						steps = append(steps, domain.SemanticStep{
							ID: msg.UUID + "-interruption-" + u32(counter), StepType: "interruption",
							StartTime: msg.Timestamp, Context: contextFor(msg), AgentID: msg.AgentID,
							Content: domain.SemanticStepContent{InterruptionText: ptrStr(text)},
						})
						counter++
					}
				}
			}
			if s, ok := asJSONString(msg.ToolUseResult); ok && s == "User rejected tool use" {
				steps = append(steps, domain.SemanticStep{
					ID: msg.UUID + "-interruption-" + u32(counter), StepType: "interruption",
					StartTime: msg.Timestamp, Context: contextFor(msg), AgentID: msg.AgentID,
					Content: domain.SemanticStepContent{InterruptionText: ptrStr("Request interrupted by user")},
				})
				counter++
			}
		}
	}

	for _, p := range processes {
		steps = append(steps, domain.SemanticStep{
			ID: p.ID, StepType: "subagent",
			StartTime: p.StartTime, EndTime: ptrStr(p.EndTime), DurationMs: p.DurationMs,
			Content: domain.SemanticStepContent{SubagentID: ptrStr(p.ID), SubagentDescription: p.Description},
			Tokens:  &domain.SemanticStepTokens{Input: p.Metrics.InputTokens, Output: p.Metrics.OutputTokens, Cached: ptrU64(p.Metrics.CacheReadTokens)},
			IsParallel: ptrBool(p.IsParallel), Context: "subagent", AgentID: ptrStr(p.ID),
		})
	}

	sort.SliceStable(steps, func(i, j int) bool { return steps[i].StartTime < steps[j].StartTime })
	return steps
}

func contextFor(m domain.ParsedMessage) string {
	if m.AgentID != nil {
		return "subagent"
	}
	return "main"
}

func toolResultContentStr(content domain.RawValue) string {
	if s, ok := asJSONString(content); ok {
		return s
	}
	return compactSortedJSON(content)
}

func asJSONString(raw domain.RawValue) (string, bool) {
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

// fillTimelineGaps mirrors timeline_gap_filling::fill_timeline_gaps.
func fillTimelineGaps(steps []domain.SemanticStep, chunkEndTime string) {
	if len(steps) == 0 {
		return
	}
	sort.SliceStable(steps, func(i, j int) bool { return steps[i].StartTime < steps[j].StartTime })
	startTimes := make([]string, len(steps))
	for i := range steps {
		startTimes[i] = steps[i].StartTime
	}
	for i := range steps {
		if steps[i].StepType == "subagent" && steps[i].EndTime != nil && steps[i].DurationMs > 100.0 {
			steps[i].EffectiveEndTime = steps[i].EndTime
			steps[i].EffectiveDurationMs = ptrF64(steps[i].DurationMs)
			steps[i].IsGapFilled = ptrBool(false)
			continue
		}
		nextStart := ""
		hasNext := false
		for j := i + 1; j < len(steps); j++ {
			if absF(timestampDiffMs(startTimes[j], startTimes[i])) >= 100.0 {
				nextStart, hasNext = startTimes[j], true
				break
			}
		}
		effectiveEnd := chunkEndTime
		if hasNext {
			effectiveEnd = nextStart
		}
		steps[i].EffectiveEndTime = ptrStr(effectiveEnd)
		steps[i].EffectiveDurationMs = ptrF64(maxF(timestampDiffMs(effectiveEnd, steps[i].StartTime), 0))
		steps[i].IsGapFilled = ptrBool(true)
	}
}

// calculateStepContext mirrors context_accumulator::calculate_step_context.
func calculateStepContext(steps []domain.SemanticStep, messages []domain.ParsedMessage) {
	for i := range steps {
		var src *domain.ParsedMessage
		if steps[i].SourceMessageID != nil {
			for j := range messages {
				if messages[j].UUID == *steps[i].SourceMessageID {
					src = &messages[j]
					break
				}
			}
		}
		if src != nil && src.Usage != nil {
			cr := uint64(0)
			if src.Usage.CacheReadInputTokens != nil {
				cr = *src.Usage.CacheReadInputTokens
			}
			cc := uint64(0)
			if src.Usage.CacheCreationInputTokens != nil {
				cc = *src.Usage.CacheCreationInputTokens
			}
			steps[i].AccumulatedContext = ptrU64(src.Usage.InputTokens + cr + cc)
		} else if steps[i].Tokens != nil {
			cached := uint64(0)
			if steps[i].Tokens.Cached != nil {
				cached = *steps[i].Tokens.Cached
			}
			steps[i].AccumulatedContext = ptrU64(steps[i].Tokens.Input + cached)
		}
		steps[i].ContextTokens = ptrU64(0)
		steps[i].TokenBreakdown = &domain.TokenBreakdown{}
	}
}

func absF(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

func u32(n uint32) string {
	return strconv.FormatUint(uint64(n), 10)
}

func ptrU64(u uint64) *uint64 { return &u }
