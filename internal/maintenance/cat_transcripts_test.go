package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScanTranscripts(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "transcripts")
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)

	// old (Mar) → candidate; older (Feb) → candidate; fresh → excluded.
	old1 := writeAged(t, filepath.Join(dir, "ses_a.jsonl"), "aaaa", time.Date(2026, 3, 2, 0, 0, 0, 0, time.Local))
	old2 := writeAged(t, filepath.Join(dir, "ses_b.jsonl"), "bb", time.Date(2026, 2, 5, 0, 0, 0, 0, time.Local))
	writeAged(t, filepath.Join(dir, "ses_fresh.jsonl"), "c", now.AddDate(0, 0, -2))

	spec := CategorySpec{ID: "transcripts", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -90)}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 {
		t.Fatalf("want 2 stale candidates, got %d", len(cands))
	}

	groups := map[string]string{}
	for _, c := range cands {
		groups[filepath.Base(c.Path)] = c.Group
	}
	if groups["ses_a.jsonl"] != "2026-03" || groups["ses_b.jsonl"] != "2026-02" {
		t.Errorf("month grouping wrong: %v", groups)
	}
	_ = old1
	_ = old2
}

// writeAged writes a file then backdates its mtime, returning the path.
func writeAged(t *testing.T, path, content string, mtime time.Time) string {
	t.Helper()
	writeFile(t, path, content)
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	return path
}
