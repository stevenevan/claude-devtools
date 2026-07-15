package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"claude-devtools/internal/config"
)

// enabledCat is a shorthand for an enabled, non-auto-approved policy category.
func enabledCat() config.RetentionCategory  { return config.RetentionCategory{Enabled: true} }
func disabledCat() config.RetentionCategory { return config.RetentionCategory{Enabled: false} }

// recorder captures the injected-closure calls (paths trashed, ids emptied) and
// the interleaved order so a test can assert "expiry ran after the categories".
type recorder struct {
	trashCalls [][]string
	emptyCalls [][]string
	ops        []string
}

func (r *recorder) trash(paths []string) error {
	r.trashCalls = append(r.trashCalls, append([]string(nil), paths...))
	r.ops = append(r.ops, "trash")
	return nil
}

func (r *recorder) emptyTrash(ids []string) error {
	r.emptyCalls = append(r.emptyCalls, append([]string(nil), ids...))
	r.ops = append(r.ops, "empty")
	return nil
}

// baseOpts wires a recorder + no-op history/expiry into RunPolicyOptions for a
// fixture root; individual tests override the fields they exercise.
func baseOpts(root, appData string, now time.Time, policy config.RetentionPolicy, r *recorder) RunPolicyOptions {
	return RunPolicyOptions{
		Root:           root,
		AppDataDir:     appData,
		Policy:         policy,
		Now:            now,
		DryRun:         false,
		CutoffFor:      func(id string) int { return CutoffDefault(id) },
		Trash:          r.trash,
		EmptyTrash:     r.emptyTrash,
		ListTrash:      func() ([]TrashReceipt, error) { return nil, nil },
		PruneHistory:   func() (int, error) { return 0, nil },
		AnalyzeHistory: func() (int, error) { return 0, nil },
	}
}

func anyPathContains(calls [][]string, needle string) bool {
	for _, batch := range calls {
		for _, p := range batch {
			if strings.Contains(p, needle) {
				return true
			}
		}
	}
	return false
}

// TestRunPolicyTrashesEnabledCategories asserts every ENABLED trash-governed
// category yields exactly one trash() call, a DISABLED one yields none, and the
// plain-delete ids are NEVER trashed even when enabled (Architect HIGH-1).
func TestRunPolicyTrashesEnabledCategories(t *testing.T) {
	root := t.TempDir()
	appData := t.TempDir()
	now := time.Now()

	// Enabled: transcripts (aged past 90d), plans (always a candidate).
	writeAged(t, filepath.Join(root, "transcripts", "ses_a.jsonl"), "aaaa", now.AddDate(0, 0, -100))
	writeFile(t, filepath.Join(root, "plans", "foo.md"), "plan")

	// Disabled: file-history uuid dir aged past 30d (dir mtime backdated too, so
	// subtreeStats' newest-descendant gate sees it as stale).
	fhDir := filepath.Join(root, "file-history", "uuid1")
	writeAged(t, filepath.Join(fhDir, "snap.txt"), "x", now.AddDate(0, 0, -40))
	if err := os.Chtimes(fhDir, now.AddDate(0, 0, -40), now.AddDate(0, 0, -40)); err != nil {
		t.Fatal(err)
	}

	// Plain-delete: logs enabled in the policy but must be skipped defensively.
	writeFile(t, filepath.Join(root, "logs", "app.log"), "log")

	// Sanity: the disabled category HAS a candidate (so "not trashed" is meaningful).
	fhCands, err := ScanCategory(context.Background(), CategorySpec{
		ID: "file-history", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -30),
	})
	if err != nil || len(fhCands) != 1 {
		t.Fatalf("fixture: file-history should have 1 candidate, got %d (err %v)", len(fhCands), err)
	}

	policy := config.RetentionPolicy{
		Categories: map[string]config.RetentionCategory{
			"transcripts":  enabledCat(),
			"plans":        enabledCat(),
			"file-history": disabledCat(),
			"logs":         enabledCat(), // plain-delete — must be skipped
		},
		TrashExpiryDays: 30,
	}
	r := &recorder{}
	report, err := RunPolicy(context.Background(), baseOpts(root, appData, now, policy, r))
	if err != nil {
		t.Fatal(err)
	}

	if len(r.trashCalls) != 2 {
		t.Fatalf("want 2 trash calls (transcripts, plans), got %d", len(r.trashCalls))
	}
	if len(report.Categories) != 2 {
		t.Fatalf("want 2 reported categories, got %d", len(report.Categories))
	}
	if !anyPathContains(r.trashCalls, filepath.Join("transcripts", "ses_a.jsonl")) {
		t.Error("transcripts candidate was not trashed")
	}
	if anyPathContains(r.trashCalls, "file-history") {
		t.Error("disabled file-history category was trashed")
	}
	if anyPathContains(r.trashCalls, filepath.Join(root, "logs")) {
		t.Error("plain-delete logs category was trashed (HIGH-1 violation)")
	}
}

// TestRunPolicyTrashExpiry asserts expiry runs LAST and empties ONLY receipts
// older than the window; a same-pass (now) receipt survives (Security F5).
func TestRunPolicyTrashExpiry(t *testing.T) {
	root := t.TempDir()
	appData := t.TempDir()
	now := time.Now()
	writeAged(t, filepath.Join(root, "transcripts", "ses_a.jsonl"), "aaaa", now.AddDate(0, 0, -100))

	oldReceipt := TrashReceipt{ID: "old-id", TrashedAt: now.AddDate(0, 0, -40)}
	newReceipt := TrashReceipt{ID: "new-id", TrashedAt: now} // same-pass

	policy := config.RetentionPolicy{
		Categories:      map[string]config.RetentionCategory{"transcripts": enabledCat()},
		TrashExpiryDays: 30,
	}
	r := &recorder{}
	opts := baseOpts(root, appData, now, policy, r)
	opts.ListTrash = func() ([]TrashReceipt, error) { return []TrashReceipt{oldReceipt, newReceipt}, nil }

	report, err := RunPolicy(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}

	if report.TrashExpiryCount != 1 {
		t.Fatalf("want TrashExpiryCount 1, got %d", report.TrashExpiryCount)
	}
	if len(r.emptyCalls) != 1 || len(r.emptyCalls[0]) != 1 || r.emptyCalls[0][0] != "old-id" {
		t.Fatalf("expiry must empty only the old receipt, got %v", r.emptyCalls)
	}
	// Order: every trash op precedes the empty op.
	if len(r.ops) != 2 || r.ops[0] != "trash" || r.ops[1] != "empty" {
		t.Fatalf("expiry must run AFTER category trashing, ops=%v", r.ops)
	}
}

// TestRunPolicyExpiryClampsZeroWindow asserts a 0 window is floored to 1 day so
// a same-pass receipt is never purged (Security F5 defense-in-depth).
func TestRunPolicyExpiryClampsZeroWindow(t *testing.T) {
	root := t.TempDir()
	appData := t.TempDir()
	now := time.Now()

	oldReceipt := TrashReceipt{ID: "old-id", TrashedAt: now.AddDate(0, 0, -40)}
	freshReceipt := TrashReceipt{ID: "fresh-id", TrashedAt: now}

	policy := config.RetentionPolicy{
		Categories:      map[string]config.RetentionCategory{"transcripts": enabledCat()},
		TrashExpiryDays: 0, // clamped to 1 inside runTrashExpiry
	}
	r := &recorder{}
	opts := baseOpts(root, appData, now, policy, r)
	opts.ListTrash = func() ([]TrashReceipt, error) { return []TrashReceipt{oldReceipt, freshReceipt}, nil }

	report, err := RunPolicy(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if report.TrashExpiryCount != 1 {
		t.Fatalf("want 1 expired (old only), got %d", report.TrashExpiryCount)
	}
	if len(r.emptyCalls) != 1 || r.emptyCalls[0][0] != "old-id" {
		t.Fatalf("a same-pass receipt must survive a 0 window, got %v", r.emptyCalls)
	}
}

// TestRunPolicyHistorySpecialCase asserts an enabled "history" category routes
// to PruneHistory (exec) / AnalyzeHistory (dry), NEVER ScanCategory (Metis 5).
func TestRunPolicyHistorySpecialCase(t *testing.T) {
	root := t.TempDir()
	appData := t.TempDir()
	now := time.Now()
	policy := config.RetentionPolicy{
		Categories:      map[string]config.RetentionCategory{"history": enabledCat()},
		TrashExpiryDays: 30,
	}

	// Execute: PruneHistory called, AnalyzeHistory not. (A ScanCategory("history")
	// would error "unknown category" — err==nil proves the special-case branch.)
	pruneCalls, analyzeCalls := 0, 0
	r := &recorder{}
	opts := baseOpts(root, appData, now, policy, r)
	opts.PruneHistory = func() (int, error) { pruneCalls++; return 7, nil }
	opts.AnalyzeHistory = func() (int, error) { analyzeCalls++; return 0, nil }
	report, err := RunPolicy(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if pruneCalls != 1 || analyzeCalls != 0 {
		t.Fatalf("exec must prune (not analyze): prune=%d analyze=%d", pruneCalls, analyzeCalls)
	}
	if len(report.Categories) != 1 || report.Categories[0].ID != "history" || report.Categories[0].Count != 7 {
		t.Fatalf("history report wrong: %+v", report.Categories)
	}
	if len(r.trashCalls) != 0 {
		t.Fatalf("history must not use the generic trash loop, got %v", r.trashCalls)
	}

	// Dry-run: AnalyzeHistory called, PruneHistory not.
	pruneCalls, analyzeCalls = 0, 0
	opts.DryRun = true
	if _, err := RunPolicy(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if analyzeCalls != 1 || pruneCalls != 0 {
		t.Fatalf("dry-run must analyze (not prune): prune=%d analyze=%d", pruneCalls, analyzeCalls)
	}
}

// TestRunPolicyCancelBetweenCategories asserts a cancel mid-pass leaves already
// -processed categories done and returns the partial report + ctx.Err() (MEDIUM-4).
func TestRunPolicyCancelBetweenCategories(t *testing.T) {
	root := t.TempDir()
	appData := t.TempDir()
	now := time.Now()
	// Two enabled categories; sorted order is plans < transcripts.
	writeFile(t, filepath.Join(root, "plans", "foo.md"), "plan")
	writeAged(t, filepath.Join(root, "transcripts", "ses_a.jsonl"), "aaaa", now.AddDate(0, 0, -100))

	policy := config.RetentionPolicy{
		Categories: map[string]config.RetentionCategory{
			"plans":       enabledCat(),
			"transcripts": enabledCat(),
		},
		TrashExpiryDays: 30,
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &recorder{}
	opts := baseOpts(root, appData, now, policy, r)
	// Cancel right after the first category (plans) is trashed.
	opts.Trash = func(paths []string) error {
		_ = r.trash(paths)
		cancel()
		return nil
	}
	opts.EmptyTrash = func(ids []string) error {
		t.Fatalf("expiry must not run after cancel, got ids %v", ids)
		return nil
	}

	report, err := RunPolicy(ctx, opts)
	if err != context.Canceled {
		t.Fatalf("want context.Canceled, got %v", err)
	}
	if len(r.trashCalls) != 1 {
		t.Fatalf("only the first category should have trashed, got %d calls", len(r.trashCalls))
	}
	if len(report.Categories) != 1 || report.Categories[0].ID != "plans" {
		t.Fatalf("partial report should hold only plans, got %+v", report.Categories)
	}
	if anyPathContains(r.trashCalls, "transcripts") {
		t.Error("transcripts must not be trashed after cancel")
	}
}

// TestRunPolicyCutoffThroughSingleSource asserts RunPolicy derives spec.Cutoff
// from CutoffFor (the MaintenanceCutoffs single source) — editing the cutoff
// moves the executed window, so preview == execution (Architect HIGH-2).
func TestRunPolicyCutoffThroughSingleSource(t *testing.T) {
	root := t.TempDir()
	appData := t.TempDir()
	now := time.Now()
	writeFile(t, filepath.Join(root, "transcripts", "ses_a.jsonl"), "aaaa")

	policy := config.RetentionPolicy{
		Categories:      map[string]config.RetentionCategory{"transcripts": enabledCat()},
		TrashExpiryDays: 30,
	}

	run := func(days int) time.Time {
		var captured time.Time
		r := &recorder{}
		opts := baseOpts(root, appData, now, policy, r)
		opts.DryRun = true
		opts.CutoffFor = func(id string) int { return days }
		opts.Enrich = func(id string, spec *CategorySpec) {
			if id == "transcripts" {
				captured = spec.Cutoff
			}
		}
		if _, err := RunPolicy(context.Background(), opts); err != nil {
			t.Fatal(err)
		}
		return captured
	}

	if got, want := run(45), now.AddDate(0, 0, -45); !got.Equal(want) {
		t.Errorf("cutoff for 45d: got %v want %v", got, want)
	}
	if got, want := run(10), now.AddDate(0, 0, -10); !got.Equal(want) {
		t.Errorf("edited cutoff to 10d must move the window: got %v want %v", got, want)
	}
}
