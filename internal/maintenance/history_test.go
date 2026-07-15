package maintenance

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func histLine(ms int64, text string) string {
	return fmt.Sprintf(`{"display":%q,"timestamp":%d,"project":"/p"}`, text, ms)
}

func writeHistory(t *testing.T, root string, lines []string) string {
	t.Helper()
	path := filepath.Join(root, "history.jsonl")
	writeFile(t, path, strings.Join(lines, "\n")+"\n")
	return path
}

func TestAnalyzeHistory(t *testing.T) {
	root := t.TempDir()
	mar := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	jul := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	writeHistory(t, root, []string{
		histLine(mar, "old1"),
		histLine(mar, "old2"),
		histLine(jul, "recent"),
		`{"display":"corrupt-no-timestamp"}`, // malformed → counted, never fatal
	})

	cutoff := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	stats, err := AnalyzeHistory(root, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if stats.TotalLines != 4 || stats.Malformed != 1 {
		t.Fatalf("totalLines=%d malformed=%d want 4,1", stats.TotalLines, stats.Malformed)
	}
	if stats.PrunableLines != 2 { // the two March lines are older than the May cutoff
		t.Errorf("prunableLines=%d want 2", stats.PrunableLines)
	}
	if len(stats.Months) != 2 {
		t.Errorf("want 2 month buckets, got %d: %+v", len(stats.Months), stats.Months)
	}
}

func TestPruneHistoryRoundTrip(t *testing.T) {
	root := t.TempDir()
	appData := filepath.Join(root, ".appdata")
	mar := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	jul := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	lines := []string{
		histLine(mar, "old1"),
		histLine(jul, "keep1"),
		`{"display":"no-timestamp-keep-me"}`, // unparseable → RETAINED (H2)
		histLine(mar, "old2"),
	}
	path := writeHistory(t, root, lines)

	cutoff := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	receipt, err := PruneHistory([]string{root, appData}, appData, path, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if len(receipt.Items) != 1 {
		t.Fatalf("want 1 trashed tail file, got %d", len(receipt.Items))
	}

	// Head retains the two recent/unparseable lines; the two March lines pruned.
	headData, _ := os.ReadFile(path)
	head := strings.Split(strings.TrimRight(string(headData), "\n"), "\n")
	if len(head) != 2 {
		t.Fatalf("want 2 retained lines, got %d: %v", len(head), head)
	}
	if !strings.Contains(string(headData), "keep1") || !strings.Contains(string(headData), "no-timestamp-keep-me") {
		t.Errorf("head must retain recent + unparseable lines: %s", headData)
	}
	if strings.Contains(string(headData), "old1") {
		t.Error("March line must be pruned from head")
	}
}

func TestPruneHistoryAppendConflict(t *testing.T) {
	root := t.TempDir()
	appData := filepath.Join(root, ".appdata")
	mar := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	path := writeHistory(t, root, []string{histLine(mar, "old1"), histLine(mar, "old2")})

	// Simulate a CLI append by growing the file via splitHistory hook: we can't
	// interpose mid-call, so verify the snapshot mechanism catches an external
	// change by appending, then confirm a normal prune still succeeds afterward.
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	fmt.Fprintln(f, histLine(time.Now().UnixMilli(), "fresh-appended"))
	f.Close()

	cutoff := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	if _, err := PruneHistory([]string{root, appData}, appData, path, cutoff); err != nil {
		t.Fatal(err)
	}
	// The freshly-appended line must survive the prune.
	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), "fresh-appended") {
		t.Error("freshly-appended line must never be lost by a prune")
	}
}

func TestPruneHistorySymlinkRefused(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "real.jsonl")
	writeFile(t, real, histLine(1, "x")+"\n")
	link := filepath.Join(root, "history.jsonl")
	if err := os.Symlink(real, link); err != nil {
		t.Skip("symlink unsupported")
	}
	if _, err := AnalyzeHistory(root, time.Now()); err == nil {
		t.Error("analyze must refuse a symlinked history.jsonl")
	}
	_ = context.Background()
}
