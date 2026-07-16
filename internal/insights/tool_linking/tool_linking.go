// Package tool_linking.
// Backs the link_tool_calls command.
package tool_linking

import (
	"encoding/json"
	"fmt"
	"time"

	"claude-devtools/internal/domain"
)

// ToolResultInfo mirrors the Rust ToolResultInfo struct.
type ToolResultInfo struct {
	Content      json.RawMessage  `json:"content"`
	IsError      bool             `json:"isError"`
	ToolUseResult json.RawMessage `json:"toolUseResult,omitempty"`
	TokenCount    *uint64         `json:"tokenCount,omitempty"`
}

// LinkedToolItem mirrors the Rust LinkedToolItem struct.
type LinkedToolItem struct {
	ID                          string          `json:"id"`
	Name                        string          `json:"name"`
	Input                       json.RawMessage `json:"input"`
	CallTokens                  *uint64         `json:"callTokens,omitempty"`
	Result                      *ToolResultInfo `json:"result,omitempty"`
	InputPreview                string          `json:"inputPreview"`
	OutputPreview               *string         `json:"outputPreview,omitempty"`
	StartTime                   string          `json:"startTime"`
	EndTime                     *string         `json:"endTime,omitempty"`
	DurationMs                  *float64        `json:"durationMs,omitempty"`
	IsOrphaned                  bool            `json:"isOrphaned"`
	SkillInstructions           *string         `json:"skillInstructions,omitempty"`
	SkillInstructionsTokenCount *uint64         `json:"skillInstructionsTokenCount,omitempty"`
}

// ParsedMessageInput is the IPC representation for extracting skill instructions.
// Mirrors the Rust ParsedMessageInput struct.
type ParsedMessageInput struct {
	MsgType         string          `json:"type"`
	IsMeta          bool            `json:"isMeta"`
	SourceToolUseID *string         `json:"sourceToolUseId,omitempty"`
	Content         json.RawMessage `json:"content"`
}

// estimateTokens mirrors tool_linking.rs::estimate_tokens (len+3)/4.
func estimateTokens(text string) uint64 {
	if text == "" {
		return 0
	}
	return uint64((len(text) + 3) / 4)
}

func truncate(text string, maxLen int) string {
	if len(text) <= maxLen {
		return text
	}
	return text[:maxLen] + "..."
}

func formatToolInput(input json.RawMessage) string {
	b, err := json.MarshalIndent(json.RawMessage(input), "", "  ")
	if err != nil {
		return "[Invalid JSON]"
	}
	return truncate(string(b), 100)
}

func formatToolResult(content json.RawMessage) string {
	var s string
	if json.Unmarshal(content, &s) == nil {
		return truncate(s, 200)
	}
	b, err := json.MarshalIndent(json.RawMessage(content), "", "  ")
	if err != nil {
		return "[Invalid result]"
	}
	return truncate(string(b), 200)
}

// LinkToolCallsToResults mirrors tool_linking.rs::link_tool_calls_to_results.
// Returns a map of call ID → LinkedToolItem; sorted-key output is guaranteed
// by returning a slice rather than a map (callers that need a map can build
// their own). The caller must sort or iterate the slice in order.
//
// NOTE: Rust returns a HashMap<String, LinkedToolItem>.  To make serialization
// deterministic (rule #4), when the caller wants to emit JSON it MUST sort the
// keys. This function returns the map directly so callers that need lookups
// still work, but the wired service method converts to sorted output.
func LinkToolCallsToResults(
	steps []domain.SemanticStep,
	responses []ParsedMessageInput,
) map[string]LinkedToolItem {
	linked := make(map[string]LinkedToolItem)

	// Index tool_result steps by ID.
	resultByID := make(map[string]*domain.SemanticStep)
	for i, s := range steps {
		if s.StepType == "tool_result" {
			resultByID[s.ID] = &steps[i]
		}
	}

	// Build skill-instructions lookup.
	skillByID := make(map[string]string)
	for _, msg := range responses {
		if msg.MsgType != "user" || !msg.IsMeta || msg.SourceToolUseID == nil {
			continue
		}
		var blocks []json.RawMessage
		if json.Unmarshal(msg.Content, &blocks) != nil {
			continue
		}
		for _, b := range blocks {
			var block struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}
			if json.Unmarshal(b, &block) != nil || block.Type != "text" {
				continue
			}
			if len(block.Text) >= 30 && block.Text[:30] == "Base directory for this skill:" {
				skillByID[*msg.SourceToolUseID] = block.Text
			}
		}
	}

	for _, step := range steps {
		if step.StepType != "tool_call" {
			continue
		}

		toolName := "Unknown"
		if step.Content.ToolName != nil {
			toolName = *step.Content.ToolName
		}

		toolInput := json.RawMessage(`{}`)
		if step.Content.ToolInput != nil {
			if b, err := json.Marshal(step.Content.ToolInput); err == nil {
				toolInput = b
			}
		}

		resultStep := resultByID[step.ID]

		var skillInstructions *string
		if toolName == "Skill" {
			if text, ok := skillByID[step.ID]; ok {
				s := text
				skillInstructions = &s
			}
		}

		callText := fmt.Sprintf("%s%s", toolName, string(toolInput))
		callTokens := estimateTokens(callText)

		var result *ToolResultInfo
		var outputPreview *string
		var endTime *string
		var durationMs *float64

		if resultStep != nil {
			content := json.RawMessage(`""`)
			if resultStep.Content.ToolResultContent != nil {
				if b, err := json.Marshal(*resultStep.Content.ToolResultContent); err == nil {
					content = b
				}
			}
			isError := false
			if resultStep.Content.IsError != nil {
				isError = *resultStep.Content.IsError
			}
			var toolUseResult json.RawMessage
			if resultStep.Content.ToolUseResult != nil {
				if b, err := json.Marshal(resultStep.Content.ToolUseResult); err == nil {
					toolUseResult = b
				}
			}
			result = &ToolResultInfo{
				Content:       content,
				IsError:       isError,
				ToolUseResult: toolUseResult,
				TokenCount:    resultStep.Content.TokenCount,
			}

			// Output preview from tool_result_content.
			contentStr := ""
			if resultStep.Content.ToolResultContent != nil {
				contentStr = *resultStep.Content.ToolResultContent
			}
			op := formatToolResult(json.RawMessage(fmt.Sprintf("%q", contentStr)))
			outputPreview = &op

			et := resultStep.StartTime
			endTime = &et

			// Duration from start time diff.
			start, err1 := time.Parse(time.RFC3339, step.StartTime)
			end, err2 := time.Parse(time.RFC3339, resultStep.StartTime)
			if err1 == nil && err2 == nil {
				d := float64(end.Sub(start).Milliseconds())
				durationMs = &d
			}
		}

		var skillTokenCount *uint64
		if skillInstructions != nil {
			t := estimateTokens(*skillInstructions)
			skillTokenCount = &t
		}

		linked[step.ID] = LinkedToolItem{
			ID:                          step.ID,
			Name:                        toolName,
			Input:                       toolInput,
			CallTokens:                  &callTokens,
			Result:                      result,
			InputPreview:                formatToolInput(toolInput),
			OutputPreview:               outputPreview,
			StartTime:                   step.StartTime,
			EndTime:                     endTime,
			DurationMs:                  durationMs,
			IsOrphaned:                  resultStep == nil,
			SkillInstructions:           skillInstructions,
			SkillInstructionsTokenCount: skillTokenCount,
		}
	}

	return linked
}
