package parsing

import (
	"encoding/json"

	"claude-devtools/internal/domain"
)

// extractToolCalls mirrors tool_extraction::extract_tool_calls: pull ToolUse
// blocks into ToolCalls; Task calls additionally surface description/subagent_type.
func extractToolCalls(content domain.ParsedMessageContent) []domain.ToolCall {
	calls := []domain.ToolCall{}
	for _, b := range content.Blocks {
		if b.Type != "tool_use" {
			continue
		}
		isTask := derefStr(b.Name) == "Task"
		tc := domain.ToolCall{
			ID:     derefStr(b.ID),
			Name:   derefStr(b.Name),
			Input:  b.Input,
			IsTask: isTask,
		}
		if isTask {
			var m map[string]json.RawMessage
			if json.Unmarshal(b.Input, &m) == nil {
				if d, ok := decodeString(m["description"]); ok {
					tc.TaskDescription = &d
				}
				if s, ok := decodeString(m["subagent_type"]); ok {
					tc.TaskSubagentType = &s
				}
			}
		}
		calls = append(calls, tc)
	}
	return calls
}

// extractToolResults mirrors tool_extraction::extract_tool_results: ToolResult
// blocks become ToolResults; content is the serialized ToolResultContentValue.
func extractToolResults(content domain.ParsedMessageContent) []domain.ToolResult {
	results := []domain.ToolResult{}
	for _, b := range content.Blocks {
		if b.Type != "tool_result" {
			continue
		}
		var raw domain.RawValue
		if b.Content != nil {
			if enc, err := json.Marshal(b.Content); err == nil {
				raw = enc
			}
		}
		if len(raw) == 0 {
			raw = domain.RawValue(`""`) // unwrap_or(Value::String(""))
		}
		isErr := false
		if b.IsError != nil {
			isErr = *b.IsError
		}
		results = append(results, domain.ToolResult{
			ToolUseID: derefStr(b.ToolUseID),
			Content:   raw,
			IsError:   isErr,
		})
	}
	return results
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
