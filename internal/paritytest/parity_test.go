package paritytest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"claude-devtools/internal/pipeline"
)

const goldenDir = "../../docs/wails-migration/golden"

type manifest struct {
	ProjectID string   `json:"projectId"`
	Sessions  []string `json:"sessions"`
}

func loadManifest(t *testing.T) manifest {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(goldenDir, "manifest.json"))
	if err != nil {
		t.Skipf("no golden manifest (%v); generate goldens first", err)
	}
	var m manifest
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("manifest: %v", err)
	}
	return m
}

// Proves the comparator loop works: a golden canonicalizes stably (idempotent)
// and DiffPath reports zero divergence against itself. Green now — this is the
// machinery the gate relies on.
func TestComparatorSelfConsistent(t *testing.T) {
	m := loadManifest(t)
	ran := 0
	for _, id := range m.Sessions {
		raw, err := os.ReadFile(filepath.Join(goldenDir, id+".json"))
		if err != nil {
			continue // blob gitignored / not generated locally
		}
		c1, err := Canonicalize(raw)
		if err != nil {
			t.Fatalf("%s: canonicalize: %v", id, err)
		}
		c2, _ := Canonicalize(c1)
		if string(c1) != string(c2) {
			t.Errorf("%s: canonicalize not idempotent", id)
		}
		if d, _ := DiffPath(raw, raw); d != "" {
			t.Errorf("%s: self-diff non-empty: %s", id, d)
		}
		ran++
	}
	if ran == 0 {
		t.Skip("no golden blobs present locally (regenerate via manifest.json note)")
	}
	t.Logf("comparator verified on %d golden(s)", ran)
}

// The parity gate. Skips until the pipeline is ported (W4), then diffs the Go
// pipeline output against each golden. Run explicitly during W3/W4:
//
//	go test ./internal/paritytest/ -run TestParityGate -v
func TestParityGate(t *testing.T) {
	m := loadManifest(t)
	for _, id := range m.Sessions {
		id := id
		t.Run(id, func(t *testing.T) {
			golden, err := os.ReadFile(filepath.Join(goldenDir, id+".json"))
			if err != nil {
				t.Skipf("golden blob missing: %v", err)
			}
			got, err := pipeline.BuildSessionDetailJSON(m.ProjectID, id)
			if err != nil {
				t.Fatalf("pipeline: %v", err)
			}
			diff, err := DiffPath(golden, got)
			if err != nil {
				t.Fatalf("diff: %v", err)
			}
			if diff != "" {
				t.Errorf("parity diverged at %s", diff)
			}
		})
	}
}
