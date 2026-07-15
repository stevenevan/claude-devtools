package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScanRuntimeTasks(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)
	old := now.AddDate(0, 0, -10)
	fresh := now.AddDate(0, 0, -1)

	// Old normal task dir (real state file + a lock marker) → runtime-tasks candidate.
	normalUUID := "11111111-0000-0000-0000-000000000001"
	writeAged(t, filepath.Join(root, "tasks", normalUUID, "state.json"), "{}", old)
	writeAged(t, filepath.Join(root, "tasks", normalUUID, ".lock"), "", old)
	backdateDir(t, filepath.Join(root, "tasks", normalUUID), old)

	// Old marker-only task dir → excluded from runtime-tasks, included in runtime-tasks-empty.
	markerUUID := "22222222-0000-0000-0000-000000000002"
	writeAged(t, filepath.Join(root, "tasks", markerUUID, ".lock"), "", old)
	writeAged(t, filepath.Join(root, "tasks", markerUUID, ".highwatermark"), "", old)
	backdateDir(t, filepath.Join(root, "tasks", markerUUID), old)

	// Fresh normal task dir (younger than cutoff) → excluded from both.
	freshUUID := "33333333-0000-0000-0000-000000000003"
	writeAged(t, filepath.Join(root, "tasks", freshUUID, "state.json"), "{}", fresh)
	backdateDir(t, filepath.Join(root, "tasks", freshUUID), fresh)

	// Today's task dir → never a candidate regardless of family.
	todayUUID := "44444444-0000-0000-0000-000000000004"
	writeAged(t, filepath.Join(root, "tasks", todayUUID, "state.json"), "{}", now)

	tasksSpec := CategorySpec{ID: "runtime-tasks", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -7)}
	tasksCands, err := ScanCategory(context.Background(), tasksSpec)
	if err != nil {
		t.Fatal(err)
	}
	tasksPaths := pathSet(tasksCands)
	if !tasksPaths[filepath.Join(root, "tasks", normalUUID)] {
		t.Errorf("old normal task dir should be a runtime-tasks candidate: %v", tasksPaths)
	}
	if tasksPaths[filepath.Join(root, "tasks", markerUUID)] {
		t.Errorf("marker-only dir must not appear in runtime-tasks")
	}
	if tasksPaths[filepath.Join(root, "tasks", freshUUID)] {
		t.Errorf("fresh task dir must be excluded")
	}
	if tasksPaths[filepath.Join(root, "tasks", todayUUID)] {
		t.Errorf("today's task dir must never be a candidate")
	}

	emptySpec := CategorySpec{ID: "runtime-tasks-empty", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -2)}
	emptyCands, err := ScanCategory(context.Background(), emptySpec)
	if err != nil {
		t.Fatal(err)
	}
	emptyPaths := pathSet(emptyCands)
	if !emptyPaths[filepath.Join(root, "tasks", markerUUID)] {
		t.Errorf("marker-only dir should be a runtime-tasks-empty candidate: %v", emptyPaths)
	}
	if emptyPaths[filepath.Join(root, "tasks", normalUUID)] {
		t.Errorf("normal task dir must not appear in runtime-tasks-empty")
	}
}

func TestScanRuntimeJobsProtectsPins(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)
	old := now.AddDate(0, 0, -10)

	writeAged(t, filepath.Join(root, "jobs", "pins.json"), "{}", old)
	otherJob := writeAged(t, filepath.Join(root, "jobs", "job-42.json"), "{}", old)
	writeAged(t, filepath.Join(root, "jobs", "today.json"), "{}", now)

	spec := CategorySpec{ID: "runtime-jobs", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -7)}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 1 || cands[0].Path != otherJob {
		t.Fatalf("want only the old non-pins job, got %+v", cands)
	}
}

func TestScanRuntimeSessionsExcludesFreshAndToday(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)

	stale := writeAged(t, filepath.Join(root, "sessions", "old-session.json"), "{}", now.AddDate(0, 0, -10))
	writeAged(t, filepath.Join(root, "sessions", "fresh-session.json"), "{}", now.AddDate(0, 0, -1))
	writeAged(t, filepath.Join(root, "sessions", "today-session.json"), "{}", now)

	spec := CategorySpec{ID: "runtime-sessions", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -7)}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 1 || cands[0].Path != stale {
		t.Fatalf("want only the stale session file, got %+v", cands)
	}
}

func TestScanRuntimeAllFamiliesRegistered(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)
	ids := []string{
		"runtime-tasks", "runtime-tasks-empty", "runtime-jobs",
		"runtime-sessions", "runtime-session-env", "runtime-shell-snapshots",
	}
	for _, id := range ids {
		spec := CategorySpec{ID: id, Root: root, Now: now}
		if _, err := ScanCategory(context.Background(), spec); err != nil {
			t.Errorf("%s: unexpected error on empty root: %v", id, err)
		}
	}
}

func TestRuntimeCutoffDefaults(t *testing.T) {
	want := map[string]int{
		"runtime-tasks": 7, "runtime-tasks-empty": 2, "runtime-jobs": 7,
		"runtime-sessions": 7, "runtime-session-env": 7, "runtime-shell-snapshots": 7,
	}
	for id, days := range want {
		if got := CutoffDefault(id); got != days {
			t.Errorf("%s: CutoffDefault=%d want %d", id, got, days)
		}
	}
}

func pathSet(cands []Candidate) map[string]bool {
	m := make(map[string]bool, len(cands))
	for _, c := range cands {
		m[c.Path] = true
	}
	return m
}

func backdateDir(t *testing.T, path string, mtime time.Time) {
	t.Helper()
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}
