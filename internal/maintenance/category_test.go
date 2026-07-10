package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIsToday(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)
	cases := []struct {
		name string
		t    time.Time
		want bool
	}{
		{"same day earlier", time.Date(2026, 7, 10, 0, 1, 0, 0, time.Local), true},
		{"same day later", time.Date(2026, 7, 10, 23, 59, 0, 0, time.Local), true},
		{"yesterday", time.Date(2026, 7, 9, 23, 59, 0, 0, time.Local), false},
		{"tomorrow", time.Date(2026, 7, 11, 0, 0, 0, 0, time.Local), false},
	}
	for _, c := range cases {
		if got := isToday(c.t, now); got != c.want {
			t.Errorf("%s: isToday=%v want %v", c.name, got, c.want)
		}
	}
}

func TestOlderThan(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)
	cutoff := now.AddDate(0, 0, -30)

	spec := CategorySpec{Now: now, Cutoff: cutoff}
	if olderThan(now, spec) {
		t.Error("today's file must never be a candidate")
	}
	if olderThan(now.AddDate(0, 0, -10), spec) {
		t.Error("10-day-old file is inside a 30-day cutoff, not a candidate")
	}
	if !olderThan(now.AddDate(0, 0, -40), spec) {
		t.Error("40-day-old file is past a 30-day cutoff, should be a candidate")
	}

	// Zero cutoff = no age gate, but still excludes today.
	noGate := CategorySpec{Now: now}
	if !olderThan(now.AddDate(0, 0, -1), noGate) {
		t.Error("zero cutoff: any non-today file is a candidate")
	}
	if olderThan(now, noGate) {
		t.Error("zero cutoff: today's file still excluded")
	}
}

func TestOpenDirNoSymlinkRefusesSymlink(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "real")
	if err := os.MkdirAll(filepath.Join(real, "child"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}

	if entries, ok, err := openDirNoSymlink(link); err != nil || ok || entries != nil {
		t.Errorf("symlinked dir must be refused: ok=%v entries=%v err=%v", ok, entries, err)
	}
	if _, ok, err := openDirNoSymlink(real); err != nil || !ok {
		t.Errorf("real dir must open: ok=%v err=%v", ok, err)
	}
	if _, ok, err := openDirNoSymlink(filepath.Join(root, "missing")); err != nil || ok {
		t.Errorf("missing dir yields (nil,false,nil): ok=%v err=%v", ok, err)
	}
}

func TestSubtreeStats(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.txt"), "hello")     // 5
	writeFile(t, filepath.Join(root, "sub", "b.txt"), "hi") // 2
	bytes, files, newest, err := subtreeStats(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if bytes != 7 || files != 2 {
		t.Errorf("bytes=%d files=%d want 7,2", bytes, files)
	}
	if newest.IsZero() {
		t.Error("newest mtime not set")
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
