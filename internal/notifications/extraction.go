// extraction.go ports src-tauri/src/notifications/trigger_checker/extraction.rs.
// Extracts tool results from a ParsedMessage and provides tool summary labels.
package notifications

import (
	"encoding/json"
	"fmt"

	"claude-devtools/internal/domain"
)

// ExtractedToolResult mirrors trigger_checker/extraction.rs ExtractedToolResult.
type ExtractedToolResult struct {
	ToolUseID string
	IsError   bool
	Content   string
	ToolName  *string
}

// ExtractToolResults collects all tool results from a message.
// Mirrors trigger_checker/extraction.rs::extract_tool_results.
func ExtractToolResults(msg *domain.ParsedMessage) []ExtractedToolResult {
	var results []ExtractedToolResult

	// From msg.ToolResults (pre-extracted by entry_parser).
	for i := range msg.ToolResults {
		tr := &msg.ToolResults[i]
		toolName := findToolNameByID(msg, tr.ToolUseID)
		results = append(results, ExtractedToolResult{
			ToolUseID: tr.ToolUseID,
			IsError:   tr.IsError,
			Content:   valueToContentString(tr.Content),
			ToolName:  toolName,
		})
	}

	// From msg.ToolUseResult (raw tool_use_result JSON blob).
	if msg.ToolUseResult != nil {
		var obj map[string]json.RawMessage
		if json.Unmarshal(msg.ToolUseResult, &obj) == nil {
			isError := false
			if v, ok := obj["isError"]; ok {
				_ = json.Unmarshal(v, &isError)
			}
			if !isError {
				if v, ok := obj["is_error"]; ok {
					_ = json.Unmarshal(v, &isError)
				}
			}

			var toolUseID string
			if v, ok := obj["toolUseId"]; ok {
				_ = json.Unmarshal(v, &toolUseID)
			}
			if toolUseID == "" && msg.SourceToolUseID != nil {
				toolUseID = *msg.SourceToolUseID
			}

			if toolUseID != "" {
				var toolName *string
				if v, ok := obj["toolName"]; ok {
					var s string
					if json.Unmarshal(v, &s) == nil {
						toolName = &s
					}
				}
				content := extractContentFromToolUseResult(msg.ToolUseResult)
				results = append(results, ExtractedToolResult{
					ToolUseID: toolUseID,
					IsError:   isError,
					Content:   content,
					ToolName:  toolName,
				})
			}
		}
	}

	// From content blocks (tool_result entries).
	for i := range msg.Content.Blocks {
		b := &msg.Content.Blocks[i]
		if b.Type != "tool_result" || b.ToolUseID == nil || b.Content == nil {
			continue
		}
		content := toolResultContentValue(b.Content)
		isError := b.IsError != nil && *b.IsError
		toolName := findToolNameByID(msg, *b.ToolUseID)
		results = append(results, ExtractedToolResult{
			ToolUseID: *b.ToolUseID,
			IsError:   isError,
			Content:   content,
			ToolName:  toolName,
		})
	}

	return results
}

// findToolNameByID searches tool calls for the name matching a tool_use ID.
func findToolNameByID(msg *domain.ParsedMessage, toolUseID string) *string {
	for i := range msg.ToolCalls {
		if msg.ToolCalls[i].ID == toolUseID {
			name := msg.ToolCalls[i].Name
			return &name
		}
	}
	if msg.SourceToolUseID != nil && *msg.SourceToolUseID == toolUseID {
		if msg.ToolUseResult != nil {
			var obj map[string]json.RawMessage
			if json.Unmarshal(msg.ToolUseResult, &obj) == nil {
				if v, ok := obj["toolName"]; ok {
					var s string
					if json.Unmarshal(v, &s) == nil {
						return &s
					}
				}
			}
		}
	}
	return nil
}

// GetToolSummary produces a short human-readable label for a tool_use call.
// Mirrors trigger_checker/extraction.rs::get_tool_summary.
func GetToolSummary(toolName string, input json.RawMessage) string {
	getStr := func(field string) string {
		var obj map[string]json.RawMessage
		if json.Unmarshal(input, &obj) != nil {
			return ""
		}
		v, ok := obj[field]
		if !ok {
			return ""
		}
		var s string
		if json.Unmarshal(v, &s) == nil {
			return s
		}
		return ""
	}

	switch toolName {
	case "Read", "Edit", "Write":
		if fp := getStr("file_path"); fp != "" {
			// Take the last path segment.
			last := fp
			for i := len(fp) - 1; i >= 0; i-- {
				if fp[i] == '/' || fp[i] == '\\' {
					last = fp[i+1:]
					break
				}
			}
			return last
		}
		return toolName
	case "Bash":
		if cmd := getStr("command"); cmd != "" {
			if len(cmd) > 60 {
				return fmt.Sprintf("%s...", cmd[:60])
			}
			return cmd
		}
		return "shell command"
	case "Grep", "Glob":
		if p := getStr("pattern"); p != "" {
			return p
		}
		return toolName
	}
	return toolName
}
