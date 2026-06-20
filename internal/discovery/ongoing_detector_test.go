package discovery

import (
	"encoding/json"
	"testing"
)

func parseEntry(t *testing.T, s string) map[string]json.RawMessage {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	return m
}

func TestIsEntryOngoing(t *testing.T) {
	cases := []struct {
		name string
		json string
		want bool
	}{
		{"assistant_end_turn", `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done!"}],"stop_reason":"end_turn","stop_sequence":null}}`, false},
		{"assistant_tool_use", `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{}}],"stop_reason":"tool_use"}}`, true},
		{"assistant_no_stop_reason", `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"thinking..."}]}}`, true},
		{"user_meta", `{"type":"user","isMeta":true,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}`, true},
		{"user_real", `{"type":"user","isMeta":false,"message":{"role":"user","content":"Hello"}}`, true},
		{"progress", `{"type":"progress","toolUseID":"t1","data":{"content":"reading file..."}}`, true},
		{"custom_title", `{"type":"custom-title","customTitle":"My Session"}`, false},
		{"turn_duration", `{"type":"turn_duration","durationMs":5000}`, false},
		{"assistant_max_tokens", `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}],"stop_reason":"max_tokens"}}`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isEntryOngoing(parseEntry(t, c.json)); got != c.want {
				t.Errorf("isEntryOngoing = %v, want %v", got, c.want)
			}
		})
	}
}
