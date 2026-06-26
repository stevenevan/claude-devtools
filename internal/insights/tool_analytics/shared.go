package tool_analytics

import (
	"encoding/json"
	"strings"
	"time"
)

// rawEntry is the minimal JSONL shape needed for tool analytics scanning.
type rawEntry struct {
	Timestamp *string  `json:"timestamp"`
	Message   *rawMsg  `json:"message"`
}

type rawMsg struct {
	Role    *string          `json:"role"`
	Content *json.RawMessage `json:"content"`
}

// parseTimestampMs parses an RFC-3339 timestamp to milliseconds since epoch.
// Returns 0 on failure (mirrors Rust unwrap_or(0.0)).
func parseTimestampMs(ts string) (float64, bool) {
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		// Try without sub-second precision.
		t2, err2 := time.Parse(time.RFC3339, ts)
		if err2 != nil {
			return 0, false
		}
		return float64(t2.UnixMilli()), true
	}
	return float64(t.UnixMilli()), true
}

// toolResultText extracts the text content from a tool_result content field.
// Mirrors shared.rs::tool_result_text.
func toolResultText(raw json.RawMessage) string {
	// Try string.
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	// Try array of content blocks.
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
