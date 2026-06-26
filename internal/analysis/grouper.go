package analysis

import (
	"sort"
	"strconv"

	"claude-devtools/internal/domain"
)

// buildSemanticStepGroups mirrors semantic_step_grouper::build_semantic_step_groups.
// Steps are grouped by sourceMessageId (empty string = the None/standalone group),
// preserving key insertion order, then sorted by start time.
func buildSemanticStepGroups(steps []domain.SemanticStep) []domain.SemanticStepGroup {
	groupsMap := map[string][]domain.SemanticStep{}
	var keyOrder []string
	seen := map[string]bool{}

	for _, step := range steps {
		key := groupKey(step)
		if !seen[key] {
			seen[key] = true
			keyOrder = append(keyOrder, key)
		}
		groupsMap[key] = append(groupsMap[key], step)
	}

	groups := []domain.SemanticStepGroup{}
	var idCounter uint32
	for _, key := range keyOrder {
		gs := groupsMap[key]
		if len(gs) == 0 {
			continue
		}
		idCounter++
		startTime := gs[0].StartTime
		endTime := startTime
		for _, s := range gs {
			e := s.StartTime
			if s.EndTime != nil {
				e = *s.EndTime
			}
			if e > endTime {
				endTime = e
			}
		}
		total := 0.0
		for _, s := range gs {
			total += s.DurationMs
		}
		var srcID *string
		if key != "" {
			k := key
			srcID = &k
		}
		groups = append(groups, domain.SemanticStepGroup{
			ID:              "group-" + strconv.FormatUint(uint64(idCounter), 10),
			Label:           buildGroupLabel(gs),
			IsGrouped:       key != "" && len(gs) > 1,
			SourceMessageID: srcID,
			Steps:           gs,
			StartTime:       startTime,
			EndTime:         endTime,
			TotalDuration:   total,
		})
	}

	sort.SliceStable(groups, func(i, j int) bool { return groups[i].StartTime < groups[j].StartTime })
	return groups
}

// groupKey is extract_message_id: sourceMessageId, or "" for standalone steps.
func groupKey(step domain.SemanticStep) string {
	if step.SourceMessageID != nil {
		return *step.SourceMessageID
	}
	return ""
}

func buildGroupLabel(steps []domain.SemanticStep) string {
	if len(steps) == 1 {
		s := steps[0]
		switch s.StepType {
		case "thinking":
			return "Thinking"
		case "tool_call":
			name := "Unknown"
			if s.Content.ToolName != nil {
				name = *s.Content.ToolName
			}
			return "Tool: " + name
		case "tool_result":
			if s.Content.IsError != nil && *s.Content.IsError {
				return "Result: Error"
			}
			return "Result: Success"
		case "subagent":
			if s.Content.SubagentDescription != nil {
				return *s.Content.SubagentDescription
			}
			return "Subagent"
		case "output":
			return "Output"
		case "interruption":
			return "Interruption"
		default:
			return "Step"
		}
	}

	hasThinking, hasOutput, toolCalls := false, false, 0
	for _, s := range steps {
		switch s.StepType {
		case "thinking":
			hasThinking = true
		case "output":
			hasOutput = true
		case "tool_call":
			toolCalls++
		}
	}
	if toolCalls > 0 {
		return "Tools (" + strconv.Itoa(toolCalls) + ")"
	}
	if hasThinking && hasOutput {
		return "Assistant Response"
	}
	if hasThinking {
		return "Thinking"
	}
	if hasOutput {
		return "Output"
	}
	return "Response (" + strconv.Itoa(len(steps)) + " steps)"
}
