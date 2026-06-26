package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"claude-devtools/internal/ptr"
)

// canon marshals v, then round-trips through interface{} so encoding/json
// re-emits with recursively key-sorted objects — the same normalization the
// parity harness applies. Lets us compare against an expected JSON literal
// without caring about field order.
func canon(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var any2 any
	if err := json.Unmarshal(b, &any2); err != nil {
		t.Fatalf("unmarshal canon: %v (%s)", err, b)
	}
	out, err := json.Marshal(any2)
	if err != nil {
		t.Fatalf("remarshal: %v", err)
	}
	return string(out)
}

func canonLiteral(t *testing.T, lit string) string {
	t.Helper()
	var any2 any
	if err := json.Unmarshal([]byte(lit), &any2); err != nil {
		t.Fatalf("bad literal %q: %v", lit, err)
	}
	out, _ := json.Marshal(any2)
	return string(out)
}

func eq(t *testing.T, got, wantLit string) {
	t.Helper()
	want := canonLiteral(t, wantLit)
	if got != want {
		t.Errorf("\n got: %s\nwant: %s", got, want)
	}
}

// skip_serializing_if optionals must OMIT the key (not emit null); non-skip
// optionals (parentUuid) must emit null; tool slices must be [] not null.
func TestParsedMessageOptionalOmission(t *testing.T) {
	m := ParsedMessage{
		UUID:        "u1",
		MessageType: "assistant",
		Timestamp:   "2026-01-01T00:00:00Z",
		Content:     ParsedMessageContent{Text: ptr.To("hello")},
		ToolCalls:   []ToolCall{},
		ToolResults: []ToolResult{},
		// all optionals left nil
	}
	got := canon(t, m)

	// non-skip optional → present as null
	if !strings.Contains(got, `"parentUuid":null`) {
		t.Errorf("parentUuid should serialize as null, got: %s", got)
	}
	// skip optionals → key absent entirely
	for _, k := range []string{"role", "usage", "model", "cwd", "gitBranch",
		"agentId", "userType", "sourceToolUseID", "sourceToolAssistantUUID",
		"toolUseResult", "isCompactSummary", "requestId", "subtype", "eventData"} {
		if strings.Contains(got, `"`+k+`"`) {
			t.Errorf("skip optional %q must be omitted, got: %s", k, got)
		}
	}
	// slices must be [] not null
	if !strings.Contains(got, `"toolCalls":[]`) || !strings.Contains(got, `"toolResults":[]`) {
		t.Errorf("tool slices must be [], got: %s", got)
	}
}

// A nil slice marshals to null — the W3 constructors must init []T{}. Guard it.
func TestNilSliceIsNullNotArray(t *testing.T) {
	var m ParsedMessage
	m.UUID, m.MessageType, m.Timestamp = "u", "user", "t"
	m.Content = ParsedMessageContent{Text: ptr.To("x")}
	got := canon(t, m)
	if !strings.Contains(got, `"toolCalls":null`) {
		t.Fatalf("expected nil slice to marshal as null (proving constructors must init []T{}): %s", got)
	}
}

func TestContentBlockVariants(t *testing.T) {
	eq(t, canon(t, ContentBlock{Type: "text", Text: ptr.To("hi")}),
		`{"type":"text","text":"hi"}`)
	eq(t, canon(t, ContentBlock{Type: "thinking", Thinking: ptr.To("t"), Signature: ptr.To("s")}),
		`{"type":"thinking","thinking":"t","signature":"s"}`)
	eq(t, canon(t, ContentBlock{Type: "tool_use", ID: ptr.To("id1"), Name: ptr.To("Read"), Input: RawValue(`{"a":1}`)}),
		`{"type":"tool_use","id":"id1","name":"Read","input":{"a":1}}`)
	// tool_result: is_error has no skip → present as null when nil
	eq(t, canon(t, ContentBlock{Type: "tool_result", ToolUseID: ptr.To("tu1"),
		Content: &ToolResultContentValue{Text: ptr.To("done")}}),
		`{"type":"tool_result","tool_use_id":"tu1","content":"done","is_error":null}`)
	eq(t, canon(t, ContentBlock{Type: "image", Source: &ImageSource{
		SourceType: "base64", MediaType: "image/png", Data: "AAA"}}),
		`{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAA"}}`)
}

func TestToolResultContentValue(t *testing.T) {
	eq(t, canon(t, ToolResultContentValue{Text: ptr.To("s")}), `"s"`)
	eq(t, canon(t, ToolResultContentValue{Blocks: []ContentBlock{{Type: "text", Text: ptr.To("b")}}}),
		`[{"type":"text","text":"b"}]`)
}

func TestParsedMessageContent(t *testing.T) {
	eq(t, canon(t, ParsedMessageContent{Text: ptr.To("plain")}), `"plain"`)
	eq(t, canon(t, ParsedMessageContent{Blocks: []ContentBlock{{Type: "text", Text: ptr.To("x")}}}),
		`[{"type":"text","text":"x"}]`)
}

// TokenUsage has no rename_all → snake_case keys; cache_* present as null.
func TestTokenUsageSnakeCase(t *testing.T) {
	eq(t, canon(t, TokenUsage{InputTokens: 10, OutputTokens: 5}),
		`{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":null,"cache_creation_input_tokens":null}`)
}

// EnhancedChunk injects the chunkType discriminator alongside inner fields.
func TestEnhancedChunkTag(t *testing.T) {
	c := EnhancedChunk{Type: "system", System: &EnhancedSystemChunk{
		ID: "c1", StartTime: "a", EndTime: "b", DurationMs: 1,
		Message:       ParsedMessage{UUID: "u", MessageType: "system", Timestamp: "t", Content: ParsedMessageContent{Text: ptr.To("o")}, ToolCalls: []ToolCall{}, ToolResults: []ToolResult{}},
		CommandOutput: "out",
		RawMessages:   []ParsedMessage{},
	}}
	got := canon(t, c)
	if !strings.Contains(got, `"chunkType":"system"`) {
		t.Errorf("missing chunkType: %s", got)
	}
	if !strings.Contains(got, `"commandOutput":"out"`) {
		t.Errorf("missing inner field: %s", got)
	}
}

// Round-trip: unmarshal then marshal a tagged chunk yields the same shape.
func TestEnhancedChunkRoundTrip(t *testing.T) {
	src := `{"chunkType":"compact","id":"c","startTime":"a","endTime":"b","durationMs":2,"metrics":{"durationMs":0,"totalTokens":0,"inputTokens":0,"outputTokens":0,"cacheReadTokens":0,"cacheCreationTokens":0,"messageCount":0},"message":{"uuid":"u","parentUuid":null,"type":"system","timestamp":"t","content":"m","isSidechain":false,"isMeta":false,"toolCalls":[],"toolResults":[]},"rawMessages":[]}`
	var c EnhancedChunk
	if err := json.Unmarshal([]byte(src), &c); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if c.Type != "compact" || c.Compact == nil {
		t.Fatalf("bad decode: %+v", c)
	}
	eq(t, canon(t, c), src)
}
