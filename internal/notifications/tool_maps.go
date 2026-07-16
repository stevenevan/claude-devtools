// tool_maps.go.
// Builds tool_use and tool_result index maps from a parsed message slice.
package notifications

import (
	"encoding/json"

	"claude-devtools/internal/domain"
)

// ToolUseInfo mirrors trigger_checker/tool_maps.rs ToolUseInfo.
type ToolUseInfo struct {
	Name string
}

// ToolResultInfo mirrors trigger_checker/tool_maps.rs ToolResultInfo.
type ToolResultInfo struct {
	Content string
}

// BuildToolUseMap indexes tool_use blocks by ID across assistant messages.
// Mirrors trigger_checker/tool_maps.rs::build_tool_use_map.
func BuildToolUseMap(messages []domain.ParsedMessage) map[string]ToolUseInfo {
	m := make(map[string]ToolUseInfo)
	for i := range messages {
		msg := &messages[i]
		if msg.MessageType != "assistant" {
			continue
		}
		for j := range msg.Content.Blocks {
			b := &msg.Content.Blocks[j]
			if b.Type == "tool_use" && b.ID != nil && b.Name != nil {
				m[*b.ID] = ToolUseInfo{Name: *b.Name}
			}
		}
		for j := range msg.ToolCalls {
			tc := &msg.ToolCalls[j]
			if _, exists := m[tc.ID]; !exists {
				m[tc.ID] = ToolUseInfo{Name: tc.Name}
			}
		}
	}
	return m
}

// BuildToolResultMap indexes tool_result content by tool_use ID.
// Mirrors trigger_checker/tool_maps.rs::build_tool_result_map.
func BuildToolResultMap(messages []domain.ParsedMessage) map[string]ToolResultInfo {
	m := make(map[string]ToolResultInfo)
	for i := range messages {
		msg := &messages[i]
		for j := range msg.Content.Blocks {
			b := &msg.Content.Blocks[j]
			if b.Type == "tool_result" && b.ToolUseID != nil && b.Content != nil {
				content := toolResultContentValue(b.Content)
				if _, exists := m[*b.ToolUseID]; !exists {
					m[*b.ToolUseID] = ToolResultInfo{Content: content}
				}
			}
		}
		for j := range msg.ToolResults {
			tr := &msg.ToolResults[j]
			if _, exists := m[tr.ToolUseID]; !exists {
				m[tr.ToolUseID] = ToolResultInfo{Content: valueToContentString(tr.Content)}
			}
		}
		if msg.ToolUseResult != nil && msg.SourceToolUseID != nil {
			content := extractContentFromToolUseResult(msg.ToolUseResult)
			if _, exists := m[*msg.SourceToolUseID]; !exists {
				m[*msg.SourceToolUseID] = ToolResultInfo{Content: content}
			}
		}
	}
	return m
}

// toolResultContentValue extracts string content from a ToolResultContentValue.
func toolResultContentValue(v *domain.ToolResultContentValue) string {
	if v.Text != nil {
		return *v.Text
	}
	return extractTextFromBlocks(v.Blocks)
}

// extractTextFromBlocks joins text blocks with newlines.
// Mirrors trigger_checker/tool_maps.rs::extract_text_from_blocks.
func extractTextFromBlocks(blocks []domain.ContentBlock) string {
	var parts []string
	for i := range blocks {
		b := &blocks[i]
		if b.Type == "text" && b.Text != nil {
			parts = append(parts, *b.Text)
		}
	}
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += "\n"
		}
		result += p
	}
	return result
}

// valueToContentString converts a json.RawMessage to string.
// Mirrors trigger_checker/tool_maps.rs::value_to_content_string.
func valueToContentString(raw domain.RawValue) string {
	if raw == nil {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return string(raw)
}

// extractContentFromToolUseResult extracts the most useful text from a tool_use_result JSON object.
// Mirrors trigger_checker/tool_maps.rs::extract_content_from_tool_use_result.
func extractContentFromToolUseResult(raw domain.RawValue) string {
	if raw == nil {
		return ""
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return ""
	}
	getStr := func(key string) string {
		v, ok := obj[key]
		if !ok {
			return ""
		}
		var s string
		if json.Unmarshal(v, &s) == nil {
			return s
		}
		return ""
	}
	if s := getStr("error"); s != "" {
		return s
	}
	if s := getStr("stderr"); s != "" {
		return s
	}
	if s := getStr("content"); s != "" {
		return s
	}
	return getStr("message")
}
