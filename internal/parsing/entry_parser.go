package parsing

import (
	"encoding/json"
	"slices"
	"time"

	"claude-devtools/internal/domain"
)

var knownTypes = []string{
	"user", "assistant", "system", "summary",
	"file-history-snapshot", "queue-operation", "progress",
}

// parseEntry mirrors entry_parser::parse_entry. Returns nil for entries with no
// uuid (except progress, which synthesizes one) or unknown types.
func parseEntry(e *domain.RawJsonlEntry) *domain.ParsedMessage {
	if !slices.Contains(knownTypes, e.EntryType) {
		return nil
	}

	var uuid string
	if e.UUID != nil && *e.UUID != "" {
		uuid = *e.UUID
	} else if e.EntryType == "progress" {
		toolID := "unknown"
		if e.ToolUseIDRef != nil {
			toolID = *e.ToolUseIDRef
		}
		ts := "0"
		if e.Timestamp != nil {
			ts = *e.Timestamp
		}
		uuid = "progress-" + toolID + "-" + ts
	} else {
		return nil
	}

	isConversational := e.EntryType == "user" || e.EntryType == "assistant" || e.EntryType == "system"

	content := textContent("")
	var role, model, requestID, subtype *string
	var usage *domain.TokenUsage
	var eventData *domain.SystemEventData
	isMeta := boolOr(e.IsMeta)
	isCompactSummary := boolOr(e.IsCompactSummary)

	if isConversational && len(e.Message) > 0 {
		var mv map[string]json.RawMessage
		_ = json.Unmarshal(e.Message, &mv)
		switch e.EntryType {
		case "user":
			if c, ok := mv["content"]; ok {
				content = parseMessageContent(c)
			}
			if r, ok := decodeString(mv["role"]); ok {
				role = &r
			}
		case "assistant":
			if c, ok := mv["content"]; ok {
				content = parseMessageContent(c)
			}
			if r, ok := decodeString(mv["role"]); ok {
				role = &r
			}
			if m, ok := decodeString(mv["model"]); ok {
				model = &m
			}
			if u, ok := mv["usage"]; ok {
				usg := parseUsage(u)
				usage = &usg
			}
			requestID = e.RequestID
		case "system":
			isMeta = boolOr(e.IsMeta)
			if e.Subtype != nil {
				subtype = e.Subtype
				eventData = buildSystemEventData(e)
			}
		}
	}

	if e.EntryType == "user" && e.IsCompactSummary != nil && *e.IsCompactSummary {
		isCompactSummary = true
	}

	if e.EntryType == "progress" {
		s := "progress"
		subtype = &s
		if len(e.Data) > 0 {
			var dm map[string]json.RawMessage
			if json.Unmarshal(e.Data, &dm) == nil {
				if msg, ok := decodeString(dm["message"]); ok {
					content = textContent(msg)
				}
			}
		}
	}

	if e.EntryType == "queue-operation" {
		s := "queue_operation"
		subtype = &s
		eventData = &domain.SystemEventData{
			Subtype:       "queue_operation",
			Operation:     e.Operation,
			QueuedContent: e.Content,
		}
	}

	timestamp := time.Now().UTC().Format(time.RFC3339)
	if e.Timestamp != nil {
		timestamp = *e.Timestamp
	}

	var parentUUID *string
	if isConversational {
		parentUUID = e.ParentUUID
	}

	var compactPtr *bool
	if isCompactSummary {
		t := true
		compactPtr = &t
	}

	return &domain.ParsedMessage{
		UUID:                    uuid,
		ParentUUID:              parentUUID,
		MessageType:             e.EntryType,
		Timestamp:               timestamp,
		Role:                    role,
		Content:                 content,
		Usage:                   usage,
		Model:                   model,
		Cwd:                     e.Cwd,
		GitBranch:               e.GitBranch,
		AgentID:                 e.AgentID,
		IsSidechain:             e.IsSidechain,
		IsMeta:                  isMeta,
		UserType:                e.UserType,
		ToolCalls:               extractToolCalls(content),
		ToolResults:             extractToolResults(content),
		SourceToolUseID:         e.SourceToolUseID,
		SourceToolAssistantUUID: e.SourceToolAssistantUUID,
		ToolUseResult:           e.ToolUseResult,
		IsCompactSummary:        compactPtr,
		RequestID:               requestID,
		Subtype:                 subtype,
		EventData:               eventData,
	}
}

func boolOr(p *bool) bool {
	return p != nil && *p
}
