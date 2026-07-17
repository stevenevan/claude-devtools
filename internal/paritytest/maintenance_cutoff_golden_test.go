package paritytest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"claude-devtools/internal/maintenance"
)

// maintenanceCutoffGoldenPath is shared with the Rust cargo test
// (src-tauri/src/maintenance/category.rs::cutoff_default_matches_go_golden),
// which loads the same JSON and asserts cutoff_default(id) == days for every
// registered category id. Guards against per-category default-cutoff drift
// between the Go matcher registry and the Rust dispatch — the constant that
// drives every retention/scan window.
const maintenanceCutoffGoldenPath = "testdata/maintenance_cutoffs.golden.json"

// The 18 registered matcher ids + the special-cased history id.
var maintenanceCutoffIDs = []string{
	"junk-dsstore", "junk-tmp", "junk-emptydirs", "plugins",
	"runtime-tasks", "runtime-tasks-empty", "runtime-jobs", "runtime-sessions",
	"runtime-session-env", "runtime-shell-snapshots", "projects", "backup-binaries",
	"caches", "logs", "logs-daemon", "file-history", "plans", "transcripts",
}

func TestMaintenanceCutoffGolden(t *testing.T) {
	cutoffs := map[string]int{}
	for _, id := range maintenanceCutoffIDs {
		cutoffs[id] = maintenance.CutoffDefault(id)
	}
	// Stable key order for a deterministic golden.
	ids := make([]string, 0, len(cutoffs))
	for id := range cutoffs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	ordered := make([][2]any, len(ids))
	for i, id := range ids {
		ordered[i] = [2]any{id, cutoffs[id]}
	}
	got, err := json.MarshalIndent(ordered, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	golden := filepath.Clean(maintenanceCutoffGoldenPath)
	if os.Getenv("GEN_GOLDENS") == "1" {
		if err := os.WriteFile(golden, append(got, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", golden)
		return
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatalf("read golden (run with GEN_GOLDENS=1 to create): %v", err)
	}
	if string(got)+"\n" != string(want) {
		t.Errorf("maintenance cutoff golden mismatch; regenerate with GEN_GOLDENS=1")
	}
}
