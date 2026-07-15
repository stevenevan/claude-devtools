package maintenanceservice

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"claude-devtools/internal/config"
	"claude-devtools/internal/maintenance"
)

// ─── due-check ─────────────────────────────────────────────────────────────────

func TestIsScheduleDue(t *testing.T) {
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	ms := func(d time.Duration) float64 { return float64(now.Add(-d).UnixMilli()) }

	cases := []struct {
		name      string
		interval  string
		lastRunMs float64
		want      bool
	}{
		{"off never fires (even if ancient)", "off", ms(365 * 24 * time.Hour), false},
		{"unknown interval never fires", "hourly", ms(365 * 24 * time.Hour), false},
		{"weekly never-run is due (catch-up)", "weekly", 0, true},
		{"weekly 8d ago is due", "weekly", ms(8 * 24 * time.Hour), true},
		{"weekly 3d ago not due", "weekly", ms(3 * 24 * time.Hour), false},
		{"monthly 40d ago is due", "monthly", ms(40 * 24 * time.Hour), true},
		{"monthly 10d ago not due", "monthly", ms(10 * 24 * time.Hour), false},
	}
	for _, tc := range cases {
		if got := isScheduleDue(tc.interval, tc.lastRunMs, now); got != tc.want {
			t.Errorf("%s: isScheduleDue=%v want %v", tc.name, got, tc.want)
		}
	}
}

// ─── partition ─────────────────────────────────────────────────────────────────

func TestPartitionScheduledPolicy(t *testing.T) {
	policy := config.RetentionPolicy{
		Categories: map[string]config.RetentionCategory{
			"plans":       {Enabled: true, AutoApproved: true},  // auto → runs
			"transcripts": {Enabled: true, AutoApproved: false}, // enabled → pending
			"plugins":     {Enabled: false, AutoApproved: true}, // disabled → neither
			"logs":        {Enabled: true, AutoApproved: true},  // plain-delete → never
		},
	}
	auto, pending := partitionScheduledPolicy(policy)

	if !auto.Categories["plans"].Enabled {
		t.Error("auto-approved plans must be enabled in the auto policy")
	}
	if auto.Categories["transcripts"].Enabled {
		t.Error("non-auto-approved transcripts must be disabled in the auto policy")
	}
	if auto.Categories["logs"].Enabled {
		t.Error("plain-delete logs must never be enabled in the auto policy (HIGH-1)")
	}
	if len(pending) != 1 || pending[0] != "transcripts" {
		t.Fatalf("pending must be exactly [transcripts], got %v", pending)
	}
}

// ─── unattended run: auto-approved only + pending report ────────────────────────

type pendingRec struct {
	called bool
	cats   []string
	bytes  int64
}

func schedTestService(t *testing.T, ssh bool) (*MaintenanceService, string, string, *pendingRec) {
	t.Helper()
	home := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(home); err == nil {
		home = resolved
	}
	appData := filepath.Join(home, "appdata")
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_DEVTOOLS_DIR", appData)
	// The trash engine resolves (lstat) both roots — create the claude root +
	// app-data dir so a fixture run has somewhere to move receipts.
	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(appData, 0o755); err != nil {
		t.Fatal(err)
	}

	rec := &pendingRec{}
	s := &MaintenanceService{
		sshActive: func() bool { return ssh },
		config:    &config.ConfigState{},
		ctx:       context.Background(),
		raisePending: func(cats []string, bytes int64) error {
			rec.called, rec.cats, rec.bytes = true, cats, bytes
			return nil
		},
	}
	return s, filepath.Join(home, ".claude"), appData, rec
}

func writeAt(t *testing.T, path, content string, mtime time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if !mtime.IsZero() {
		if err := os.Chtimes(path, mtime, mtime); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRunScheduledCleanAutoApprovedOnly(t *testing.T) {
	s, root, appData, rec := schedTestService(t, false)
	now := time.Now()

	planFile := filepath.Join(root, "plans", "foo.md")
	transcriptFile := filepath.Join(root, "transcripts", "ses_a.jsonl")
	writeAt(t, planFile, "plan body", time.Time{})                  // plans: always a candidate
	writeAt(t, transcriptFile, "aaaabbbb", now.AddDate(0, 0, -100)) // transcripts: aged past 90d

	policy := config.RetentionPolicy{
		Categories: map[string]config.RetentionCategory{
			"plans":       {Enabled: true, AutoApproved: true},  // runs unattended
			"transcripts": {Enabled: true, AutoApproved: false}, // → pending report
		},
		TrashExpiryDays:  30,
		ScheduleInterval: "weekly",
	}
	if err := s.config.SetRetentionPolicy(policy); err != nil {
		t.Fatal(err)
	}

	if err := s.runScheduledClean(); err != nil {
		t.Fatalf("runScheduledClean: %v", err)
	}

	// Auto-approved plans was trashed (gone from disk).
	if _, err := os.Stat(planFile); !os.IsNotExist(err) {
		t.Errorf("auto-approved plans file should have been trashed, stat err=%v", err)
	}
	// Non-auto-approved transcripts was NOT trashed (still present).
	if _, err := os.Stat(transcriptFile); err != nil {
		t.Errorf("non-auto-approved transcripts must survive an unattended run: %v", err)
	}
	// A trash receipt was produced (trash + receipts).
	receipts, err := maintenance.ListTrash(appData)
	if err != nil {
		t.Fatal(err)
	}
	if len(receipts) == 0 {
		t.Error("expected at least one trash receipt from the auto-approved run")
	}
	// The rest became a pending notification with a nonzero size.
	if !rec.called {
		t.Fatal("raisePending was not called for the non-auto-approved categories")
	}
	if len(rec.cats) != 1 || rec.cats[0] != "transcripts" {
		t.Errorf("pending report must list [transcripts], got %v", rec.cats)
	}
	if rec.bytes <= 0 {
		t.Errorf("pending report bytes should be > 0, got %d", rec.bytes)
	}
	// The app recorded its own last-run timestamp.
	if s.config.GetLastCleanupMs() <= 0 {
		t.Error("last-cleanup timestamp was not recorded")
	}
}

func TestRunScheduledCleanRefusesUnderSSH(t *testing.T) {
	s, root, appData, rec := schedTestService(t, true) // sshActive = true
	planFile := filepath.Join(root, "plans", "foo.md")
	writeAt(t, planFile, "plan body", time.Time{})

	policy := config.RetentionPolicy{
		Categories: map[string]config.RetentionCategory{
			"plans": {Enabled: true, AutoApproved: true},
		},
		TrashExpiryDays:  30,
		ScheduleInterval: "weekly",
	}
	if err := s.config.SetRetentionPolicy(policy); err != nil {
		t.Fatal(err)
	}

	err := s.runScheduledClean()
	if err == nil {
		t.Fatal("runScheduledClean must refuse under an active SSH session")
	}
	// Nothing was trashed.
	if _, statErr := os.Stat(planFile); statErr != nil {
		t.Errorf("plans file must be untouched when SSH-gated: %v", statErr)
	}
	receipts, listErr := maintenance.ListTrash(appData)
	if listErr != nil {
		t.Fatal(listErr)
	}
	if len(receipts) != 0 {
		t.Errorf("no trash receipt may be created under SSH, got %d", len(receipts))
	}
	if rec.called {
		t.Error("a refused run must not proceed to raise a pending report")
	}
}

// TestMaybeRunScheduledOffNeverFires asserts an "off" schedule never runs even
// when the last-run anchor is ancient.
func TestMaybeRunScheduledOffNeverFires(t *testing.T) {
	s, root, appData, rec := schedTestService(t, false)
	planFile := filepath.Join(root, "plans", "foo.md")
	writeAt(t, planFile, "plan body", time.Time{})

	policy := config.RetentionPolicy{
		Categories:       map[string]config.RetentionCategory{"plans": {Enabled: true, AutoApproved: true}},
		TrashExpiryDays:  30,
		ScheduleInterval: "off",
	}
	if err := s.config.SetRetentionPolicy(policy); err != nil {
		t.Fatal(err)
	}
	_ = s.config.SetLastCleanupMs(1) // ancient, but "off" is never due

	s.maybeRunScheduled()

	if _, err := os.Stat(planFile); err != nil {
		t.Errorf("an off schedule must not trash anything: %v", err)
	}
	receipts, _ := maintenance.ListTrash(appData)
	if len(receipts) != 0 {
		t.Errorf("off schedule must create no receipts, got %d", len(receipts))
	}
	if rec.called {
		t.Error("off schedule must not raise a pending report")
	}
}

// TestSchedulerStartStopClean asserts the ticker goroutine starts on
// ServiceStartup and joins cleanly on ServiceShutdown (LOW-8) — no leak/hang.
func TestSchedulerStartStopClean(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_DEVTOOLS_DIR", filepath.Join(home, "appdata"))

	s := New(func() bool { return false }, nil, nil)
	if err := s.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() { done <- s.ServiceShutdown() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ServiceShutdown: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("ServiceShutdown hung — scheduler goroutine did not join")
	}
}
