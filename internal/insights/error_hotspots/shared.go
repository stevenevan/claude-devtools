package error_hotspots

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"claude-devtools/internal/discovery"
)

// rawEntry is the minimal JSONL shape for error hotspot scanning.
type rawEntry struct {
	Timestamp *string `json:"timestamp"`
	Message   *rawMsg `json:"message"`
}

type rawMsg struct {
	Role    *string          `json:"role"`
	Content *json.RawMessage `json:"content"`
}

// toolCall tracks an in-flight tool_use awaiting its tool_result.
type toolCall struct {
	toolName string
}

// parseTimestampMs parses an RFC-3339 timestamp to ms since epoch.
func parseTimestampMs(ts string) (float64, bool) {
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		t2, err2 := time.Parse(time.RFC3339, ts)
		if err2 != nil {
			return 0, false
		}
		return float64(t2.UnixMilli()), true
	}
	return float64(t.UnixMilli()), true
}

// toolResultText extracts text from a tool_result content field.
func toolResultText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []json.RawMessage
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, b := range blocks {
		var block struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(b, &block) == nil && block.Type == "text" {
			parts = append(parts, block.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// normalizeErrorPrefix trims, clips to errorPrefixLen runes, and collapses
// whitespace. Mirrors shared.rs::normalize_error_prefix.
func normalizeErrorPrefix(text string) string {
	trimmed := strings.TrimSpace(text)
	// Clip to errorPrefixLen runes.
	runes := []rune(trimmed)
	if len(runes) > errorPrefixLen {
		// Ensure we don't split a multibyte char — use utf8 safe clip.
		clipped := make([]byte, 0, errorPrefixLen*4)
		count := 0
		for i := 0; i < len(trimmed) && count < errorPrefixLen; {
			r, size := utf8.DecodeRuneInString(trimmed[i:])
			_ = r
			clipped = append(clipped, trimmed[i:i+size]...)
			i += size
			count++
		}
		trimmed = string(clipped)
	}
	// Collapse whitespace.
	fields := strings.Fields(trimmed)
	return strings.Join(fields, " ")
}

// resolveProjectDir resolves the project directory from a project ID.
func resolveProjectDir(projectID string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory")
	}
	claudeDir := home + "/.claude"
	projectsDir := discovery.GetProjectsBasePath(claudeDir)

	baseID := projectID
	if i := strings.Index(projectID, "::"); i >= 0 {
		baseID = projectID[:i]
	}
	dir := projectsDir + "/" + baseID
	info, err2 := os.Stat(dir)
	if err2 != nil || !info.IsDir() {
		return "", fmt.Errorf("project directory not found: %s", baseID)
	}
	return dir, nil
}
