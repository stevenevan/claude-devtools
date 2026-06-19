package parsing

import (
	"regexp"
	"strings"

	"claude-devtools/internal/domain"
)

// Message tag constants (types/constants.rs).
const (
	localCommandStdoutTag = "<local-command-stdout>"
	localCommandStderrTag = "<local-command-stderr>"
	localCommandCaveatTag = "<local-command-caveat>"
	systemReminderTag     = "<system-reminder>"
	emptyStdout           = "<local-command-stdout></local-command-stdout>"
	emptyStderr           = "<local-command-stderr></local-command-stderr>"
)

var systemOutputTags = []string{localCommandStderrTag, localCommandStdoutTag, localCommandCaveatTag, systemReminderTag}
var hardNoiseTags = []string{localCommandCaveatTag, systemReminderTag}

var teammateRegex = regexp.MustCompile(`^<teammate-message\s+teammate_id="([^"]+)"`)

var displayableSubtypes = map[string]bool{
	"api_error": true, "bridge_status": true, "memory_saved": true, "turn_duration": true,
}

// Categorize mirrors category_rules::categorize_message. Order: event →
// hardNoise → compact → system → user → ai.
func Categorize(m *domain.ParsedMessage) domain.MessageCategory {
	switch {
	case isEventMessage(m):
		return domain.CategoryEvent
	case isHardNoiseMessage(m):
		return domain.CategoryHardNoise
	case isCompactMessage(m):
		return domain.CategoryCompact
	case isSystemChunkMessage(m):
		return domain.CategorySystem
	case isUserChunkMessage(m):
		return domain.CategoryUser
	default:
		return domain.CategoryAi
	}
}

func isEventMessage(m *domain.ParsedMessage) bool {
	if m.MessageType == "system" {
		return m.Subtype != nil && displayableSubtypes[*m.Subtype]
	}
	return m.MessageType == "queue-operation"
}

func isHardNoiseMessage(m *domain.ParsedMessage) bool {
	switch m.MessageType {
	case "system":
		if m.Subtype != nil && displayableSubtypes[*m.Subtype] {
			return false
		}
		return true
	case "summary", "file-history-snapshot", "progress":
		return true
	}
	if m.MessageType == "assistant" && m.Model != nil && *m.Model == "<synthetic>" {
		return true
	}
	if m.MessageType == "user" {
		if t, ok := textOf(m.Content); ok {
			trimmed := strings.TrimSpace(t)
			for _, tag := range hardNoiseTags {
				closeTag := strings.Replace(tag, "<", "</", 1)
				if strings.HasPrefix(trimmed, tag) && strings.HasSuffix(trimmed, closeTag) {
					return true
				}
			}
			if trimmed == emptyStdout || trimmed == emptyStderr {
				return true
			}
			if strings.HasPrefix(trimmed, "[Request interrupted by user") {
				return true
			}
		} else if len(m.Content.Blocks) == 1 {
			b := m.Content.Blocks[0]
			if b.Type == "text" && strings.HasPrefix(derefStr(b.Text), "[Request interrupted by user") {
				return true
			}
		}
	}
	return false
}

func isCompactMessage(m *domain.ParsedMessage) bool {
	return m.IsCompactSummary != nil && *m.IsCompactSummary
}

func isSystemChunkMessage(m *domain.ParsedMessage) bool {
	if m.MessageType != "user" {
		return false
	}
	if t, ok := textOf(m.Content); ok {
		return strings.HasPrefix(t, localCommandStdoutTag) || strings.HasPrefix(t, localCommandStderrTag)
	}
	for _, b := range m.Content.Blocks {
		if b.Type == "text" && strings.HasPrefix(derefStr(b.Text), localCommandStdoutTag) {
			return true
		}
	}
	return false
}

func isUserChunkMessage(m *domain.ParsedMessage) bool {
	if m.MessageType != "user" || m.IsMeta {
		return false
	}
	if isTeammateMessage(m) {
		return false
	}
	if t, ok := textOf(m.Content); ok {
		trimmed := strings.TrimSpace(t)
		for _, tag := range systemOutputTags {
			if strings.HasPrefix(trimmed, tag) {
				return false
			}
		}
		return trimmed != ""
	}
	blocks := m.Content.Blocks
	hasUserContent := false
	for _, b := range blocks {
		if b.Type == "text" || b.Type == "image" {
			hasUserContent = true
			break
		}
	}
	if !hasUserContent {
		return false
	}
	if len(blocks) == 1 && blocks[0].Type == "text" &&
		strings.HasPrefix(derefStr(blocks[0].Text), "[Request interrupted by user") {
		return false
	}
	for _, b := range blocks {
		if b.Type == "text" {
			for _, tag := range systemOutputTags {
				if strings.HasPrefix(derefStr(b.Text), tag) {
					return false
				}
			}
		}
	}
	return true
}

func isTeammateMessage(m *domain.ParsedMessage) bool {
	if m.MessageType != "user" || m.IsMeta {
		return false
	}
	if t, ok := textOf(m.Content); ok {
		return teammateRegex.MatchString(strings.TrimSpace(t))
	}
	for _, b := range m.Content.Blocks {
		if b.Type == "text" && teammateRegex.MatchString(strings.TrimSpace(derefStr(b.Text))) {
			return true
		}
	}
	return false
}

func textOf(c domain.ParsedMessageContent) (string, bool) {
	if c.Text != nil {
		return *c.Text, true
	}
	return "", false
}
