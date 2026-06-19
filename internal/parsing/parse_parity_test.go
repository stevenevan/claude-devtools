package parsing

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"claude-devtools/internal/paritytest"
)

const goldenDir = "../../docs/wails-migration/golden"

type manifest struct {
	ProjectID string   `json:"projectId"`
	Sessions  []string `json:"sessions"`
}

// Validates entry_parser + streaming: the Go-parsed messages[] must match the
// `messages` array of each golden SessionDetail byte-for-byte (after key-sort).
func TestMessagesParity(t *testing.T) {
	mb, err := os.ReadFile(filepath.Join(goldenDir, "manifest.json"))
	if err != nil {
		t.Skipf("no manifest: %v", err)
	}
	var m manifest
	if err := json.Unmarshal(mb, &m); err != nil {
		t.Fatalf("manifest: %v", err)
	}
	home, _ := os.UserHomeDir()
	ran := 0
	for _, id := range m.Sessions {
		goldenBytes, err := os.ReadFile(filepath.Join(goldenDir, id+".json"))
		if err != nil {
			continue
		}
		src := filepath.Join(home, ".claude", "projects", m.ProjectID, id+".jsonl")
		if _, err := os.Stat(src); err != nil {
			continue
		}
		ran++
		t.Run(id, func(t *testing.T) {
			msgs, _, err := ParseJSONLFile(src)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			got, err := json.Marshal(msgs)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var detail map[string]json.RawMessage
			if err := json.Unmarshal(goldenBytes, &detail); err != nil {
				t.Fatalf("golden: %v", err)
			}
			diff, err := paritytest.DiffPath(detail["messages"], got)
			if err != nil {
				t.Fatalf("diff: %v", err)
			}
			if diff != "" {
				t.Errorf("messages diverge at %s (parsed %d msgs)", diff, len(msgs))
			}
		})
	}
	if ran == 0 {
		t.Skip("no golden+source pairs present locally")
	}
}

// Validates metrics: Go CalculateMetrics(messages) must match each golden's
// top-level `metrics` object.
func TestMetricsParity(t *testing.T) {
	m := loadGoldenManifest(t)
	home, _ := os.UserHomeDir()
	ran := 0
	for _, id := range m.Sessions {
		goldenBytes, err := os.ReadFile(filepath.Join(goldenDir, id+".json"))
		if err != nil {
			continue
		}
		src := filepath.Join(home, ".claude", "projects", m.ProjectID, id+".jsonl")
		if _, err := os.Stat(src); err != nil {
			continue
		}
		ran++
		t.Run(id, func(t *testing.T) {
			msgs, _, err := ParseJSONLFile(src)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			got, err := json.Marshal(CalculateMetrics(msgs))
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var detail map[string]json.RawMessage
			if err := json.Unmarshal(goldenBytes, &detail); err != nil {
				t.Fatalf("golden: %v", err)
			}
			diff, err := paritytest.DiffPath(detail["metrics"], got)
			if err != nil {
				t.Fatalf("diff: %v", err)
			}
			if diff != "" {
				t.Errorf("metrics diverge at %s", diff)
			}
		})
	}
	if ran == 0 {
		t.Skip("no golden+source pairs present locally")
	}
}

func loadGoldenManifest(t *testing.T) manifest {
	t.Helper()
	mb, err := os.ReadFile(filepath.Join(goldenDir, "manifest.json"))
	if err != nil {
		t.Skipf("no manifest: %v", err)
	}
	var m manifest
	if err := json.Unmarshal(mb, &m); err != nil {
		t.Fatalf("manifest: %v", err)
	}
	return m
}
