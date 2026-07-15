package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScanFileHistory(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "file-history")
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)

	// Old UUID dir: newest snapshot 40 days ago → stale candidate. The UUID
	// dir itself must also be backdated — subtreeStats' "newest" includes the
	// dir's own mtime, and a freshly os.MkdirAll'd dir would otherwise carry
	// today's real mtime and mask the backdated file inside it.
	staleUUID := "aaaaaaaa-0000-0000-0000-000000000001"
	staleAge := now.AddDate(0, 0, -40)
	writeAged(t, filepath.Join(dir, staleUUID, "v1"), "snap1", staleAge)
	if err := os.Chtimes(filepath.Join(dir, staleUUID), staleAge, staleAge); err != nil {
		t.Fatal(err)
	}

	// Fresh UUID dir: edited 2 days ago → excluded.
	freshUUID := "bbbbbbbb-0000-0000-0000-000000000002"
	writeAged(t, filepath.Join(dir, freshUUID, "v1"), "snap1", now.AddDate(0, 0, -2))

	// Empty UUID dir (no snapshot files) → empty candidate regardless of age.
	emptyUUID := "cccccccc-0000-0000-0000-000000000003"
	if err := os.MkdirAll(filepath.Join(dir, emptyUUID), 0o755); err != nil {
		t.Fatal(err)
	}

	spec := CategorySpec{ID: "file-history", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -30)}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 {
		t.Fatalf("want 2 candidates (stale + empty), got %d: %+v", len(cands), cands)
	}

	groups := map[string]string{}
	for _, c := range cands {
		groups[c.Meta["uuid"]] = c.Group
	}
	if groups[staleUUID] != "stale" {
		t.Errorf("stale UUID dir group=%q want stale", groups[staleUUID])
	}
	if groups[emptyUUID] != "empty" {
		t.Errorf("empty UUID dir group=%q want empty", groups[emptyUUID])
	}
	if _, ok := groups[freshUUID]; ok {
		t.Errorf("fresh UUID dir must be excluded, got %v", groups)
	}
}
