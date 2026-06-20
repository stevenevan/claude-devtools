package discovery

import (
	"encoding/json"
	"testing"
)

func TestIsDisplayableContent(t *testing.T) {
	cases := []struct {
		name string
		json string
		want bool
	}{
		{"string", `"hello world"`, true},
		{"noise_caveat", `"<local-command-caveat>stuff</local-command-caveat>"`, false},
		{"noise_empty_stdout", `"<local-command-stdout></local-command-stdout>"`, false},
		{"array_text", `[{"type":"text","text":"hello"}]`, true},
		{"array_interruption", `[{"type":"text","text":"[Request interrupted by user]"}]`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isDisplayableContent(json.RawMessage(c.json)); got != c.want {
				t.Errorf("isDisplayableContent = %v, want %v", got, c.want)
			}
		})
	}
}
