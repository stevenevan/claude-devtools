package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestScanJunkDSStore(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)

	// Nested .DS_Store, several levels deep, plus one at the root.
	writeFile(t, filepath.Join(root, "agents", "skills", ".DS_Store"), "x")
	writeFile(t, filepath.Join(root, ".DS_Store"), "x")

	// AppData subtree must be excluded even though it has its own .DS_Store.
	appData := filepath.Join(root, ".claude-devtools")
	writeFile(t, filepath.Join(appData, "trash", ".DS_Store"), "x")

	spec := CategorySpec{ID: "junk-dsstore", Root: root, AppData: appData, Now: now}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 {
		t.Fatalf("want 2 .DS_Store candidates (nested + root-level), got %d: %+v", len(cands), cands)
	}
	for _, c := range cands {
		if strings.HasPrefix(c.Path, appData) {
			t.Errorf("AppData subtree must be excluded from the sweep, got candidate %s", c.Path)
		}
	}
}

func TestScanJunkTmp(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)

	stale := writeAged(t, filepath.Join(root, "shell-snapshots", "old.tmp"), "x", now.AddDate(0, 0, -5))
	writeAged(t, filepath.Join(root, "shell-snapshots", "new.tmp"), "x", now) // today: in-progress write

	spec := CategorySpec{ID: "junk-tmp", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -1)}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 1 || cands[0].Path != stale {
		t.Fatalf("want only the stale .tmp as a candidate, got %+v", cands)
	}
}

func TestScanJunkEmptyDirs(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)

	// Real top-level file so root itself never collapses.
	writeFile(t, filepath.Join(root, "config.json"), "{}")

	// Empty top-level protected dirs → never candidates even though empty.
	for _, name := range []string{"projects", "todos", "plugins"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	// Empty chain a/b/c → must collapse to exactly ONE candidate: a.
	if err := os.MkdirAll(filepath.Join(root, "a", "b", "c"), 0o755); err != nil {
		t.Fatal(err)
	}

	spec := CategorySpec{ID: "junk-emptydirs", Root: root, Now: now}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 1 {
		t.Fatalf("want exactly 1 candidate (topmost empty dir, no nested inputs), got %d: %+v", len(cands), cands)
	}
	if want := filepath.Join(root, "a"); cands[0].Path != want {
		t.Errorf("want candidate %s, got %s", want, cands[0].Path)
	}
}
