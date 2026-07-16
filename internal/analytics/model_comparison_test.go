package analytics

import "testing"

func TestFamilyForKnownModels(t *testing.T) {
	cases := []struct {
		model string
		want  string
	}{
		{"claude-opus-4-6-20260101", "opus"},
		{"claude-sonnet-4-20250514", "sonnet"},
		{"claude-haiku-4-5-20251001", "haiku"},
		{"gpt-4o", "other"},
	}
	for _, c := range cases {
		got := FamilyFor(c.model)
		if got != c.want {
			t.Errorf("FamilyFor(%q): got %q, want %q", c.model, got, c.want)
		}
	}
}
