// Package parsing ports src-tauri/src/parsing/ (the W3 gate path): JSONL bytes
// → []domain.ParsedMessage, byte-faithful to the Rust pipeline.
package parsing

import (
	"bytes"
	"encoding/json"
	"strconv"

	"claude-devtools/internal/domain"
)

// parseMessageContent mirrors content_normalization::parse_message_content:
// a JSON string → Text; an array → Blocks (unrecognized/malformed blocks are
// skipped, matching serde's `filter_map(from_value().ok())`); anything else →
// empty Text.
func parseMessageContent(v json.RawMessage) domain.ParsedMessageContent {
	v = bytes.TrimSpace(v)
	if len(v) == 0 {
		return textContent("")
	}
	switch v[0] {
	case '"':
		var s string
		if json.Unmarshal(v, &s) == nil {
			return textContent(s)
		}
		return textContent("")
	case '[':
		var arr []json.RawMessage
		if json.Unmarshal(v, &arr) != nil {
			return textContent("")
		}
		blocks := []domain.ContentBlock{}
		for _, el := range arr {
			var cb domain.ContentBlock
			if json.Unmarshal(el, &cb) == nil { // skip on error = serde filter_map
				blocks = append(blocks, cb)
			}
		}
		return domain.ParsedMessageContent{Blocks: blocks}
	default:
		return textContent("")
	}
}

func textContent(s string) domain.ParsedMessageContent {
	return domain.ParsedMessageContent{Text: &s}
}

// parseUsage mirrors content_normalization::parse_usage. as_u64 in Rust yields
// None for non-integer/negative values → 0 for the required fields, nil for the
// optional cache fields.
func parseUsage(v json.RawMessage) domain.TokenUsage {
	var m map[string]json.RawMessage
	_ = json.Unmarshal(v, &m)
	return domain.TokenUsage{
		InputTokens:              asU64(m["input_tokens"]),
		OutputTokens:             asU64(m["output_tokens"]),
		CacheReadInputTokens:     asU64opt(m["cache_read_input_tokens"]),
		CacheCreationInputTokens: asU64opt(m["cache_creation_input_tokens"]),
	}
}

// --- decode helpers ---

func decodeString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

func asU64(raw json.RawMessage) uint64 {
	if v := asU64opt(raw); v != nil {
		return *v
	}
	return 0
}

func asU64opt(raw json.RawMessage) *uint64 {
	if len(raw) == 0 {
		return nil
	}
	n, err := strconv.ParseUint(string(bytes.TrimSpace(raw)), 10, 64)
	if err != nil {
		return nil // non-integer (float, negative, string) → as_u64 None
	}
	return &n
}
