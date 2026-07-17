// Package paritytest holds the Go↔Rust byte-parity harness. It parses the
// committed synthetic fixtures with the Go pipeline and compares against golden
// JSON; the Rust cargo tests assert their own output matches the same goldens
// (Cycle B plan, Strategy §2). The W7 addition compares both CLIs end-to-end.
package paritytest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"claude-devtools/internal/parsing"
)

// canon mirrors internal/domain/marshal_test.go:canon — recursively key-sorts
// and coerces every number to float64, so key order and int-vs-float spelling
// don't affect the comparison. Both operands pass through it.
func canon(t *testing.T, raw []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("canon unmarshal: %v (%s)", err, raw)
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("canon marshal: %v", err)
	}
	return string(out)
}

// TestMessagesGolden parses each testdata/*.jsonl fixture with the Go parser and
// compares its ParsedMessage[] against a committed golden. Run with GEN_GOLDENS=1
// to (re)generate the goldens after adding or changing a fixture.
func TestMessagesGolden(t *testing.T) {
	fixtures, err := filepath.Glob("testdata/*.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(fixtures) == 0 {
		t.Fatal("no testdata/*.jsonl fixtures found")
	}
	for _, fx := range fixtures {
		name := strings.TrimSuffix(filepath.Base(fx), ".jsonl")
		t.Run(name, func(t *testing.T) {
			messages, _, err := parsing.ParseJSONLFile(fx)
			if err != nil {
				t.Fatalf("parse %s: %v", fx, err)
			}
			got, err := json.Marshal(messages)
			if err != nil {
				t.Fatal(err)
			}
			golden := filepath.Join("testdata", name+".messages.golden.json")
			if os.Getenv("GEN_GOLDENS") == "1" {
				if err := os.WriteFile(golden, append(got, '\n'), 0o644); err != nil {
					t.Fatal(err)
				}
				t.Logf("wrote %s", golden)
				return
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatalf("read golden (GEN_GOLDENS=1 to create): %v", err)
			}
			if g, w := canon(t, got), canon(t, want); g != w {
				t.Errorf("golden mismatch %s\n got: %s\nwant: %s", name, g, w)
			}
		})
	}
}
