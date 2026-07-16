// checks.go.
// The three trigger check functions: tool_result, tool_use, and token_threshold.
package notifications

import (
	"encoding/json"
	"fmt"

	"claude-devtools/internal/config"
	"claude-devtools/internal/discovery"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/ptr"
)

// CheckToolResultTrigger checks a tool_result trigger against one message.
// Mirrors trigger_checker/checks.rs::check_tool_result_trigger.
func CheckToolResultTrigger(
	msg *domain.ParsedMessage,
	trigger *config.NotificationTrigger,
	toolUseMap map[string]ToolUseInfo,
	sessionID, projectID, filePath string,
	lineNumber uint32,
) *DetectedError {
	results := ExtractToolResults(msg)

	cwdHint := ""
	if msg.Cwd != nil {
		cwdHint = *msg.Cwd
	}

	for i := range results {
		r := &results[i]

		if trigger.RequireError != nil && *trigger.RequireError {
			if !r.IsError {
				continue
			}
			errMsg := r.Content
			if len(errMsg) == 0 {
				errMsg = "Unknown error"
			}
			if MatchesIgnorePatterns(errMsg, trigger.IgnorePatterns) {
				continue
			}
			source := "tool_result"
			if r.ToolName != nil {
				source = *r.ToolName
			}
			e := CreateDetectedError(CreateDetectedErrorParams{
				SessionID:    sessionID,
				ProjectID:    projectID,
				FilePath:     filePath,
				ProjectName:  discovery.ExtractProjectName(projectID, cwdHint),
				LineNumber:   lineNumber,
				Source:       source,
				Message:      errMsg,
				TimestampMS:  ParseTimestampMS(msg.Timestamp),
				Cwd:          msg.Cwd,
				ToolUseID:    &r.ToolUseID,
				TriggerColor: trigger.Color,
				TriggerID:    ptr.To(trigger.ID),
				TriggerName:  ptr.To(trigger.Name),
			})
			return &e
		}

		if trigger.ToolName != nil {
			info, ok := toolUseMap[r.ToolUseID]
			if !ok || info.Name != *trigger.ToolName {
				continue
			}

			if trigger.MatchField != nil && *trigger.MatchField == "content" {
				if trigger.MatchPattern == nil {
					continue
				}
				if !MatchesPattern(r.Content, *trigger.MatchPattern) {
					continue
				}
				if MatchesIgnorePatterns(r.Content, trigger.IgnorePatterns) {
					continue
				}
				preview := r.Content
				if len(preview) > 200 {
					preview = preview[:200]
				}
				e := CreateDetectedError(CreateDetectedErrorParams{
					SessionID:    sessionID,
					ProjectID:    projectID,
					FilePath:     filePath,
					ProjectName:  discovery.ExtractProjectName(projectID, cwdHint),
					LineNumber:   lineNumber,
					Source:       *trigger.ToolName,
					Message:      fmt.Sprintf("Tool result matched: %s", preview),
					TimestampMS:  ParseTimestampMS(msg.Timestamp),
					Cwd:          msg.Cwd,
					ToolUseID:    &r.ToolUseID,
					TriggerColor: trigger.Color,
					TriggerID:    ptr.To(trigger.ID),
					TriggerName:  ptr.To(trigger.Name),
				})
				return &e
			}
		}
	}
	return nil
}

// CheckToolUseTrigger checks a tool_use trigger against one assistant message.
// Mirrors trigger_checker/checks.rs::check_tool_use_trigger.
func CheckToolUseTrigger(
	msg *domain.ParsedMessage,
	trigger *config.NotificationTrigger,
	sessionID, projectID, filePath string,
	lineNumber uint32,
) *DetectedError {
	if msg.MessageType != "assistant" {
		return nil
	}

	cwdHint := ""
	if msg.Cwd != nil {
		cwdHint = *msg.Cwd
	}

	for i := range msg.Content.Blocks {
		b := &msg.Content.Blocks[i]
		if b.Type != "tool_use" || b.ID == nil || b.Name == nil {
			continue
		}

		if trigger.ToolName != nil && *b.Name != *trigger.ToolName {
			continue
		}

		var fieldValue string
		if trigger.MatchField != nil {
			fv := ExtractToolUseField(b.Input, *trigger.MatchField)
			if fv == nil {
				continue
			}
			fieldValue = *fv
		} else {
			raw, _ := json.Marshal(b.Input)
			fieldValue = string(raw)
		}

		if trigger.MatchPattern != nil && !MatchesPattern(fieldValue, *trigger.MatchPattern) {
			continue
		}

		if MatchesIgnorePatterns(fieldValue, trigger.IgnorePatterns) {
			continue
		}

		preview := fieldValue
		if len(preview) > 200 {
			preview = preview[:200]
		}
		label := "tool_use"
		if trigger.MatchField != nil {
			label = *trigger.MatchField
		}

		toolUseID := *b.ID
		e := CreateDetectedError(CreateDetectedErrorParams{
			SessionID:    sessionID,
			ProjectID:    projectID,
			FilePath:     filePath,
			ProjectName:  discovery.ExtractProjectName(projectID, cwdHint),
			LineNumber:   lineNumber,
			Source:       *b.Name,
			Message:      fmt.Sprintf("%s: %s", label, preview),
			TimestampMS:  ParseTimestampMS(msg.Timestamp),
			Cwd:          msg.Cwd,
			ToolUseID:    &toolUseID,
			TriggerColor: trigger.Color,
			TriggerID:    ptr.To(trigger.ID),
			TriggerName:  ptr.To(trigger.Name),
		})
		return &e
	}
	return nil
}

// CheckTokenThresholdTrigger checks a token_threshold trigger against one assistant message.
// Returns multiple errors (one per tool_use exceeding threshold).
// Mirrors trigger_checker/checks.rs::check_token_threshold_trigger.
func CheckTokenThresholdTrigger(
	msg *domain.ParsedMessage,
	trigger *config.NotificationTrigger,
	toolResultMap map[string]ToolResultInfo,
	sessionID, projectID, filePath string,
	lineNumber uint32,
) []DetectedError {
	var errors []DetectedError

	if trigger.Mode != "token_threshold" {
		return errors
	}
	if trigger.TokenThreshold == nil {
		return errors
	}
	threshold := int(*trigger.TokenThreshold)

	if msg.MessageType != "assistant" {
		return errors
	}

	tokenType := "total"
	if trigger.TokenType != nil {
		tokenType = *trigger.TokenType
	}

	cwdHint := ""
	if msg.Cwd != nil {
		cwdHint = *msg.Cwd
	}

	// Collect tool_use blocks, deduplicating by ID.
	type toolUseEntry struct {
		id    string
		name  string
		input domain.RawValue
	}
	seenIDs := make(map[string]bool)
	var toolUses []toolUseEntry

	for i := range msg.Content.Blocks {
		b := &msg.Content.Blocks[i]
		if b.Type == "tool_use" && b.ID != nil && b.Name != nil {
			if !seenIDs[*b.ID] {
				seenIDs[*b.ID] = true
				toolUses = append(toolUses, toolUseEntry{*b.ID, *b.Name, b.Input})
			}
		}
	}
	for i := range msg.ToolCalls {
		tc := &msg.ToolCalls[i]
		if !seenIDs[tc.ID] {
			seenIDs[tc.ID] = true
			toolUses = append(toolUses, toolUseEntry{tc.ID, tc.Name, tc.Input})
		}
	}

	for _, tu := range toolUses {
		if trigger.ToolName != nil && tu.name != *trigger.ToolName {
			continue
		}

		inputJSON, _ := json.Marshal(tu.input)
		callStr := tu.name + string(inputJSON)
		callTokens := EstimateTokens(callStr)

		resultTokens := 0
		if ri, ok := toolResultMap[tu.id]; ok {
			resultTokens = EstimateTokens(ri.Content)
		}

		var tokenCount int
		switch tokenType {
		case "input":
			tokenCount = callTokens
		case "output":
			tokenCount = resultTokens
		default:
			tokenCount = callTokens + resultTokens
		}

		if tokenCount <= threshold {
			continue
		}

		summary := GetToolSummary(tu.name, tu.input)
		typeLabel := ""
		if tokenType != "total" {
			typeLabel = " " + tokenType
		}
		tokenMsg := fmt.Sprintf("%s - %s : ~%s%s tokens", tu.name, summary, FormatTokens(tokenCount), typeLabel)

		if MatchesIgnorePatterns(tokenMsg, trigger.IgnorePatterns) {
			continue
		}

		toolUseID := tu.id
		errors = append(errors, CreateDetectedError(CreateDetectedErrorParams{
			SessionID:    sessionID,
			ProjectID:    projectID,
			FilePath:     filePath,
			ProjectName:  discovery.ExtractProjectName(projectID, cwdHint),
			LineNumber:   lineNumber,
			Source:       tu.name,
			Message:      tokenMsg,
			TimestampMS:  ParseTimestampMS(msg.Timestamp),
			Cwd:          msg.Cwd,
			ToolUseID:    &toolUseID,
			TriggerColor: trigger.Color,
			TriggerID:    ptr.To(trigger.ID),
			TriggerName:  ptr.To(trigger.Name),
		}))
	}

	return errors
}
