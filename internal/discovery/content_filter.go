package discovery

// Session content filter — detect noise-only sessions to skip in the UI.

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"

	"claude-devtools/internal/domain"
)

// HasNonNoiseMessages returns true on the first displayable entry found.
// Early-exits for performance. Mirrors content_filter::has_non_noise_messages.
func HasNonNoiseMessages(filePath string) bool {
	f, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 10*1024*1024), 10*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry domain.RawJsonlEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		if isDisplayableEntry(&entry) {
			return true
		}
	}
	return false
}

func isDisplayableEntry(entry *domain.RawJsonlEntry) bool {
	switch entry.EntryType {
	case "assistant":
		// Filter synthetic assistant messages.
		if len(entry.Message) > 0 {
			var msg map[string]json.RawMessage
			if json.Unmarshal(entry.Message, &msg) == nil {
				if rawModel, ok := msg["model"]; ok {
					var model string
					if json.Unmarshal(rawModel, &model) == nil && model == "<synthetic>" {
						return false
					}
				}
			}
		}
		return entry.UUID != nil

	case "user":
		if entry.UUID == nil {
			return false
		}
		// Skip meta messages (tool results).
		if entry.IsMeta != nil && *entry.IsMeta {
			return false
		}
		if len(entry.Message) > 0 {
			var msg map[string]json.RawMessage
			if json.Unmarshal(entry.Message, &msg) == nil {
				if rawContent, ok := msg["content"]; ok {
					return isDisplayableContent(rawContent)
				}
			}
		}
		return false

	default:
		return false
	}
}

// noiseStringPrefixes matches content_filter.rs's noise_prefixes slice.
var noiseStringPrefixes = []string{
	"<local-command-caveat>",
	"<system-reminder>",
	"<local-command-stdout></local-command-stdout>",
	"<local-command-stderr></local-command-stderr>",
	"[Request interrupted by user",
}

// noiseTextBlockPrefixes is the subset applied to individual text blocks in arrays.
var noiseTextBlockPrefixes = []string{
	"[Request interrupted by user",
	"<local-command-caveat>",
	"<system-reminder>",
}

func isDisplayableContent(raw json.RawMessage) bool {
	// Try string.
	var text string
	if json.Unmarshal(raw, &text) == nil {
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			return false
		}
		for _, p := range noiseStringPrefixes {
			if strings.HasPrefix(trimmed, p) {
				return false
			}
		}
		return true
	}

	// Try array of content blocks.
	var blocks []json.RawMessage
	if json.Unmarshal(raw, &blocks) != nil {
		return false
	}
	for _, blockRaw := range blocks {
		var block map[string]json.RawMessage
		if json.Unmarshal(blockRaw, &block) != nil {
			continue
		}
		var blockType string
		if rawType, ok := block["type"]; ok {
			_ = json.Unmarshal(rawType, &blockType)
		}
		switch blockType {
		case "text":
			var t string
			if rawText, ok := block["text"]; ok && json.Unmarshal(rawText, &t) == nil {
				trimmed := strings.TrimSpace(t)
				if trimmed == "" {
					continue
				}
				isNoise := false
				for _, p := range noiseTextBlockPrefixes {
					if strings.HasPrefix(trimmed, p) {
						isNoise = true
						break
					}
				}
				if !isNoise {
					return true
				}
			}
		case "image":
			return true
		}
	}
	return false
}
