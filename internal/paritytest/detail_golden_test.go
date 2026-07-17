package paritytest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"claude-devtools/internal/analysis"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
	"claude-devtools/internal/ptr"
)

// stubSession is the fixed Session stub both the Go golden and the Rust parity
// test build, so the SessionDetail golden depends only on the fixture messages
// (mirrors the hardcoded stub in pipeline.BuildSessionDetail). Processes are
// empty here — subagent-populated detail is covered by W6's dump-detail.
func stubSession(name string, messages []domain.ParsedMessage, meta parsing.SessionFileMetadata) domain.Session {
	return domain.Session{
		ID:            name,
		ProjectID:     "paritytest",
		ProjectPath:   "",
		CreatedAt:     0,
		HasSubagents:  false,
		MessageCount:  uint32(len(messages)),
		IsOngoing:     ptr.To(false),
		MetadataLevel: ptr.To("deep"),
		CustomTitle:   meta.CustomTitle,
		AgentName:     meta.AgentName,
	}
}

// TestSessionDetailGolden builds analysis.BuildSessionDetail for each fixture and
// compares (or regenerates with GEN_GOLDENS=1) against a golden. The Rust cargo
// test asserts its build_session_detail matches the same golden (Cycle B §2, W5).
func TestSessionDetailGolden(t *testing.T) {
	fixtures, err := filepath.Glob("testdata/*.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	for _, fx := range fixtures {
		name := strings.TrimSuffix(filepath.Base(fx), ".jsonl")
		t.Run(name, func(t *testing.T) {
			messages, meta, err := parsing.ParseJSONLFile(fx)
			if err != nil {
				t.Fatalf("parse %s: %v", fx, err)
			}
			detail := analysis.BuildSessionDetail(stubSession(name, messages, meta), messages, []domain.Process{})
			got, err := json.Marshal(detail)
			if err != nil {
				t.Fatal(err)
			}
			golden := filepath.Join("testdata", name+".detail.golden.json")
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
				t.Errorf("detail golden mismatch %s\n got: %s\nwant: %s", name, g, w)
			}
		})
	}
}
