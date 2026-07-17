package paritytest

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"claude-devtools/internal/analytics"
)

// TestAnalyticsCLIParity is the W8 CI-gated parity gate for the home+days
// analytics scanners. Unlike TestCLIParityRealCorpus (which needs a populated
// ~/.claude and skips in CI), this builds a SYNTHETIC $HOME with now-relative
// timestamps so the ≤90-day window always contains data, sets HOME for BOTH the
// in-process Go call and the Rust CLI subprocess, and canon-compares their LIVE
// outputs to each other (not a static golden — the date-bucket labels depend on
// time.Now(), which matches only because both run in the same second).
//
// It still visible-skips when the Rust binary is absent (a bare `go test`
// without `cargo build --bin claude-devtools-cli`), but it no longer skips for a
// missing real corpus — CI that builds the binary runs it deterministically.
func TestAnalyticsCLIParity(t *testing.T) {
	rust := rustCLI()
	if _, err := os.Stat(rust); err != nil {
		t.Skipf("rust cli not built: %s (run: cd src-tauri && cargo build --bin claude-devtools-cli)", rust)
	}
	guardMidnight(t)

	home := t.TempDir()
	writeSyntheticCorpus(t, home)
	// t.Setenv makes os.UserHomeDir() (Go, in-process) and the Rust subprocess
	// (inherits env) both resolve the synthetic corpus. Restored after the test.
	t.Setenv("HOME", home)

	cases := []struct {
		name    string
		cliArgs []string
		goJSON  func() ([]byte, error)
	}{
		{"analytics", []string{"dump-analytics", "30"}, func() ([]byte, error) {
			r, err := analytics.ComputeAnalytics(30)
			if err != nil {
				return nil, err
			}
			return json.Marshal(r)
		}},
		{"productivity", []string{"dump-productivity", "30"}, func() ([]byte, error) {
			r, err := analytics.ComputeProductivityMetrics(30)
			if err != nil {
				return nil, err
			}
			return json.Marshal(r)
		}},
		{"duration", []string{"dump-duration", "30"}, func() ([]byte, error) {
			r, err := analytics.ComputeSessionDurationStats(30)
			if err != nil {
				return nil, err
			}
			return json.Marshal(r)
		}},
		{"model-comparison", []string{"dump-model-comparison", "30"}, func() ([]byte, error) {
			r, err := analytics.ComputeModelComparison(30)
			if err != nil {
				return nil, err
			}
			return json.Marshal(r)
		}},
		{"cost-forecast", []string{"dump-cost-forecast", "14"}, func() ([]byte, error) {
			r, err := analytics.ComputeCostForecast(14)
			if err != nil {
				return nil, err
			}
			return json.Marshal(r)
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			goJSON, err := tc.goJSON()
			if err != nil {
				t.Fatalf("go compute %s: %v", tc.name, err)
			}
			out, err := exec.Command(rust, tc.cliArgs...).Output()
			if err != nil {
				t.Fatalf("rust cli %v: %v", tc.cliArgs, err)
			}
			// Numeric-tolerant compare, NOT exact canon: cost-derived floats go
			// through multiply-add chains that Go's compiler FMA-fuses on
			// darwin/arm64 (but not on default amd64) while Rust does not — a
			// ~1-ULP, arch-dependent difference. Hard-coding mul_add into Rust
			// would match arm64 Go but diverge from amd64 Go, so parity here is
			// numeric equality to full f64 precision modulo the last ULP, which
			// still catches any real logic bug (those differ far above tolerance).
			// The exact-canon tier stays for Cycle B's passthrough-number detail.
			if diff := numericParityDiff(goJSON, out); diff != "" {
				t.Errorf("analytics parity mismatch %s: %s\n go: %s\nrust: %s", tc.name, diff, goJSON, out)
			}
		})
	}
}

// numericParityDiff unmarshals both payloads and compares them structurally,
// treating float leaves as equal within a relative/absolute tolerance (so
// FMA-vs-non-FMA ~1-ULP noise passes while a real logic bug — orders of
// magnitude larger — still fails). Returns "" on match, else the first diff path.
func numericParityDiff(a, b []byte) string {
	var va, vb any
	if err := json.Unmarshal(a, &va); err != nil {
		return fmt.Sprintf("go json invalid: %v", err)
	}
	if err := json.Unmarshal(b, &vb); err != nil {
		return fmt.Sprintf("rust json invalid: %v", err)
	}
	return compareValue("$", va, vb)
}

func compareValue(path string, a, b any) string {
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok {
			return fmt.Sprintf("%s: type object vs %T", path, b)
		}
		if len(av) != len(bv) {
			return fmt.Sprintf("%s: object len %d vs %d", path, len(av), len(bv))
		}
		for k, aval := range av {
			bval, ok := bv[k]
			if !ok {
				return fmt.Sprintf("%s.%s: missing on rust side", path, k)
			}
			if d := compareValue(path+"."+k, aval, bval); d != "" {
				return d
			}
		}
	case []any:
		bv, ok := b.([]any)
		if !ok {
			return fmt.Sprintf("%s: type array vs %T", path, b)
		}
		if len(av) != len(bv) {
			return fmt.Sprintf("%s: array len %d vs %d", path, len(av), len(bv))
		}
		for i := range av {
			if d := compareValue(fmt.Sprintf("%s[%d]", path, i), av[i], bv[i]); d != "" {
				return d
			}
		}
	case float64:
		bv, ok := b.(float64)
		if !ok {
			return fmt.Sprintf("%s: number vs %T", path, b)
		}
		if !floatsClose(av, bv) {
			return fmt.Sprintf("%s: %v vs %v (beyond tolerance)", path, av, bv)
		}
	default:
		if a != b {
			return fmt.Sprintf("%s: %v vs %v", path, a, b)
		}
	}
	return ""
}

// floatsClose reports equality within relative 1e-9 (absolute 1e-12 near zero).
// ULP-level FMA noise is ~1e-16 relative; a real logic bug is ≥1e-3 relative.
func floatsClose(a, b float64) bool {
	if a == b {
		return true
	}
	diff := math.Abs(a - b)
	if diff <= 1e-12 {
		return true
	}
	scale := math.Max(math.Abs(a), math.Abs(b))
	return diff <= 1e-9*scale
}

// guardMidnight skips when within 5s of local midnight: the Go in-process call
// and the Rust subprocess each read time.Now() independently, so a day-boundary
// straddle would produce different date buckets and a spurious mismatch.
func guardMidnight(t *testing.T) {
	t.Helper()
	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	sinceMid := now.Sub(midnight)
	if sinceMid < 5*time.Second || sinceMid > 24*time.Hour-5*time.Second {
		t.Skip("within 5s of local midnight; skipping to avoid a day-boundary straddle")
	}
}

// writeSyntheticCorpus writes a synthetic ~/.claude/projects corpus with
// NOW-RELATIVE timestamps so the ≤90-day analytics window is non-empty. Purely
// synthetic — no real ~/.claude content is copied. Two projects, distinct
// models, several recent days each, so buckets/model-comparison/forecast are all
// exercised.
func writeSyntheticCorpus(t *testing.T, home string) {
	t.Helper()
	now := time.Now()
	type sess struct {
		project string
		file    string
		model   string
		dayAgo  int
		lines   int
	}
	sessions := []sess{
		{"-Users-test-alpha", "s1", "claude-opus-4-8", 1, 4},
		{"-Users-test-alpha", "s2", "claude-sonnet-5", 3, 3},
		{"-Users-test-alpha", "s3", "claude-opus-4-8", 6, 5},
		{"-Users-test-beta", "s4", "claude-sonnet-5", 2, 4},
		{"-Users-test-beta", "s5", "claude-haiku-4-5-20251001", 9, 2},
	}
	for _, s := range sessions {
		dir := filepath.Join(home, ".claude", "projects", s.project)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		base := now.AddDate(0, 0, -s.dayAgo)
		var b []byte
		// A first real user message (feeds firstUserText / titles).
		user := map[string]any{
			"type":      "user",
			"timestamp": base.Format(time.RFC3339Nano),
			"isMeta":    false,
			"message":   map[string]any{"role": "user", "content": "synthetic prompt " + s.file},
		}
		ub, _ := json.Marshal(user)
		b = append(append(b, ub...), '\n')
		// Assistant turns a few minutes apart (active-ms + duration signal).
		for i := 0; i < s.lines; i++ {
			ts := base.Add(time.Duration(i) * 2 * time.Minute)
			entry := map[string]any{
				"type":      "assistant",
				"timestamp": ts.Format(time.RFC3339Nano),
				"message": map[string]any{
					"role":  "assistant",
					"model": s.model,
					"usage": map[string]any{
						"input_tokens":                100 + i*10,
						"output_tokens":               50 + i*5,
						"cache_read_input_tokens":     20 + i,
						"cache_creation_input_tokens": 10 + i,
					},
					"content": []map[string]any{
						{"type": "tool_use", "name": "Read"},
					},
				},
			}
			eb, _ := json.Marshal(entry)
			b = append(append(b, eb...), '\n')
		}
		if err := os.WriteFile(filepath.Join(dir, s.file+".jsonl"), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// Sanity: the Go scanner sees the corpus (guards against a silently-empty test).
	if _, err := os.Stat(filepath.Join(home, ".claude", "projects", "-Users-test-alpha", "s1.jsonl")); err != nil {
		t.Fatal(fmt.Errorf("synthetic corpus not written: %w", err))
	}
}
