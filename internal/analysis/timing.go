// Package analysis ports src-tauri/src/analysis/ (the W4 gate path): messages →
// chunks → SessionDetail, byte-faithful to the Rust pipeline.
package analysis

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"time"
)

// timestampDiffMs mirrors time_util::timestamp_diff_ms: millis(a) - millis(b),
// with unparseable timestamps treated as 0.
func timestampDiffMs(a, b string) float64 {
	return tsMillis(a) - tsMillis(b)
}

func tsMillis(s string) float64 {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return 0
	}
	return float64(t.UnixMilli())
}

// countTokens mirrors semantic_step_extractor::count_tokens — the gate's token
// estimate is ceil(bytes/4), NOT tiktoken (arch C2).
func countTokens(s string) uint64 {
	if s == "" {
		return 0
	}
	return uint64(math.Ceil(float64(len(s)) / 4.0))
}

// compactSortedJSON reproduces serde_json::to_string(&Value): compact, object
// keys sorted (serde_json::Value is a BTreeMap), HTML escaping OFF (serde does
// not escape <>&). Used for token-count parity on tool inputs/results.
func compactSortedJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if dec.Decode(&v) != nil {
		return string(raw)
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if enc.Encode(v) != nil {
		return string(raw)
	}
	return strings.TrimRight(buf.String(), "\n")
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func ptrStr(s string) *string  { return &s }
func ptrBool(b bool) *bool      { return &b }
func ptrF64(f float64) *float64 { return &f }
func ptrU32(u uint32) *uint32   { return &u }
