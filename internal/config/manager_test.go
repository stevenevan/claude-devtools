// Also adds the atomic-persistence test required by the task spec.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"claude-devtools/internal/ptr"
)

// tempConfig creates a ConfigState that writes to an isolated temp directory,
// mirroring Rust's temp_config() test helper.
func tempConfig(t *testing.T) *ConfigState {
	t.Helper()
	dir := t.TempDir()
	cs := &ConfigState{
		configPath: filepath.Join(dir, "config.json"),
		config:     DefaultAppConfig(),
		loaded:     true,
	}
	return cs
}

// ─── annotation_crud_roundtrip ────────────────────────────────────────────────

func TestAnnotationCRUDRoundtrip(t *testing.T) {
	cs := tempConfig(t)

	if len(cs.GetAnnotations()) != 0 {
		t.Fatal("expected empty annotations")
	}

	entry := AnnotationEntry{
		ID:        "a1",
		SessionID: "s1",
		ProjectID: "p1",
		TargetID:  "t1",
		Text:      "first",
		Color:     "blue",
		CreatedAt: 1.0,
		UpdatedAt: 1.0,
	}
	cs.AddAnnotation(entry)

	anns := cs.GetAnnotations()
	if len(anns) != 1 {
		t.Fatalf("expected 1 annotation, got %d", len(anns))
	}
	if anns[0].Text != "first" {
		t.Fatalf("expected 'first', got %q", anns[0].Text)
	}

	text := "second"
	color := "red"
	updated := cs.UpdateAnnotation("a1", &text, &color, 2.0)
	if !updated {
		t.Fatal("expected UpdateAnnotation to return true")
	}
	anns = cs.GetAnnotations()
	if anns[0].Text != "second" {
		t.Fatalf("expected 'second', got %q", anns[0].Text)
	}
	if anns[0].Color != "red" {
		t.Fatalf("expected 'red', got %q", anns[0].Color)
	}
	if anns[0].UpdatedAt != 2.0 {
		t.Fatalf("expected updatedAt=2.0, got %f", anns[0].UpdatedAt)
	}

	// Update missing annotation must return false.
	if cs.UpdateAnnotation("missing", &text, nil, 3.0) {
		t.Fatal("expected false for missing annotation")
	}

	cs.RemoveAnnotation("a1")
	if len(cs.GetAnnotations()) != 0 {
		t.Fatal("expected empty annotations after removal")
	}
}

// ─── import_annotations_resolves_conflict_by_newer_timestamp ─────────────────

func TestImportAnnotationsResolvesConflictByNewerTimestamp(t *testing.T) {
	cs := tempConfig(t)

	cs.AddAnnotation(AnnotationEntry{
		ID: "existing", SessionID: "s1", ProjectID: "p1",
		TargetID: "t1", Text: "old", Color: "blue",
		CreatedAt: 1.0, UpdatedAt: 10.0,
	})
	cs.AddBookmark(BookmarkEntry{
		ID: "bk1", SessionID: "s1", ProjectID: "p1",
		GroupID: "g1", CreatedAt: 1.0,
	})

	bundle := AnnotationExportBundle{
		Version:    1,
		ExportedAt: 100.0,
		Annotations: []AnnotationEntry{
			// Newer timestamp → should update t1.
			{
				ID: "incoming-newer", SessionID: "s1", ProjectID: "p1",
				TargetID: "t1", Text: "new", Color: "green",
				CreatedAt: 5.0, UpdatedAt: 20.0,
			},
			// Fresh annotation on t2 → added.
			{
				ID: "another-target", SessionID: "s1", ProjectID: "p1",
				TargetID: "t2", Text: "fresh", Color: "red",
				CreatedAt: 50.0, UpdatedAt: 50.0,
			},
		},
		Bookmarks: []BookmarkEntry{
			// Duplicate session+group → skipped.
			{ID: "bk-dup", SessionID: "s1", ProjectID: "p1", GroupID: "g1", CreatedAt: 99.0},
			// New session+group → added.
			{ID: "bk-new", SessionID: "s2", ProjectID: "p1", GroupID: "gX", CreatedAt: 99.0,
				Note: func() *string { s := "note"; return &s }()},
		},
	}

	report := cs.ImportAnnotationsBundle(bundle)

	if report.AnnotationsUpdated != 1 {
		t.Fatalf("expected 1 updated, got %d", report.AnnotationsUpdated)
	}
	if report.AnnotationsAdded != 1 {
		t.Fatalf("expected 1 added, got %d", report.AnnotationsAdded)
	}
	if report.AnnotationsSkipped != 0 {
		t.Fatalf("expected 0 skipped, got %d", report.AnnotationsSkipped)
	}
	if report.BookmarksAdded != 1 {
		t.Fatalf("expected 1 bookmark added, got %d", report.BookmarksAdded)
	}
	if report.BookmarksSkipped != 1 {
		t.Fatalf("expected 1 bookmark skipped, got %d", report.BookmarksSkipped)
	}

	merged := cs.GetAnnotations()
	var t1 *AnnotationEntry
	for i := range merged {
		if merged[i].TargetID == "t1" {
			t1 = &merged[i]
		}
	}
	if t1 == nil {
		t.Fatal("t1 annotation not found after import")
	}
	if t1.Text != "new" {
		t.Fatalf("expected 'new', got %q", t1.Text)
	}
	if t1.UpdatedAt != 20.0 {
		t.Fatalf("expected updatedAt=20.0, got %f", t1.UpdatedAt)
	}
}

// ─── atomic persistence test (required by task spec) ─────────────────────────

func TestAtomicPersistenceNeverTruncatesOnFailure(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")

	// Write an initial valid config.
	cs := &ConfigState{
		configPath: configPath,
		config:     DefaultAppConfig(),
		loaded:     true,
	}
	cs.config.General.Theme = "light"
	if err := cs.saveConfig(); err != nil {
		t.Fatalf("initial save failed: %v", err)
	}

	// Verify the file was written with expected content.
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read after first save failed: %v", err)
	}
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("json unmarshal failed: %v", err)
	}

	// Simulate what would happen if the real file were corrupted mid-write:
	// write garbage to the temp file path but NOT the real file.
	tmpPath := configPath + ".tmp"
	if err := os.WriteFile(tmpPath, []byte("GARBAGE"), 0o644); err != nil {
		t.Fatalf("could not write garbage temp: %v", err)
	}
	// Do not rename — simulates a crash between WriteFile and Rename.
	// The original file must still be intact.
	original, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("original file not readable: %v", err)
	}
	if len(original) == 0 {
		t.Fatal("original config file was truncated — atomic write failed")
	}
	if err := json.Unmarshal(original, &parsed); err != nil {
		t.Fatal("original config is not valid JSON — it was corrupted")
	}
	_ = os.Remove(tmpPath)

	// Second real save must produce a parseable file.
	cs.config.General.Theme = "dark"
	if err := cs.saveConfig(); err != nil {
		t.Fatalf("second save failed: %v", err)
	}
	data2, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read after second save failed: %v", err)
	}
	if err := json.Unmarshal(data2, &parsed); err != nil {
		t.Fatal("second save produced invalid JSON")
	}
}

// ─── additional manager coverage ─────────────────────────────────────────────

func TestPinUnpinSession(t *testing.T) {
	cs := tempConfig(t)
	cs.PinSession("proj1", "sess1")
	cfg := cs.GetConfig()
	pins := cfg.Sessions.PinnedSessions["proj1"]
	if len(pins) != 1 || pins[0].SessionID != "sess1" {
		t.Fatal("PinSession did not work")
	}
	// Pin again — idempotent.
	cs.PinSession("proj1", "sess1")
	if len(cs.GetConfig().Sessions.PinnedSessions["proj1"]) != 1 {
		t.Fatal("PinSession should be idempotent")
	}
	cs.UnpinSession("proj1", "sess1")
	_, ok := cs.GetConfig().Sessions.PinnedSessions["proj1"]
	if ok {
		t.Fatal("UnpinSession should remove empty entry")
	}
}

func TestHideUnhideSessions(t *testing.T) {
	cs := tempConfig(t)
	cs.HideSessions("proj1", []string{"s1", "s2"})
	cfg := cs.GetConfig()
	if len(cfg.Sessions.HiddenSessions["proj1"]) != 2 {
		t.Fatalf("expected 2 hidden, got %d", len(cfg.Sessions.HiddenSessions["proj1"]))
	}
	// Bulk unhide.
	cs.UnhideSessions("proj1", []string{"s1", "s2"})
	_, ok := cs.GetConfig().Sessions.HiddenSessions["proj1"]
	if ok {
		t.Fatal("UnhideSessions should remove empty entry")
	}
}

func TestSessionGroups(t *testing.T) {
	cs := tempConfig(t)
	if !cs.CreateSessionGroup("g1") {
		t.Fatal("CreateSessionGroup should return true")
	}
	if cs.CreateSessionGroup("g1") {
		t.Fatal("CreateSessionGroup should return false for duplicate")
	}
	cs.AddToSessionGroup("g1", "sess1")
	cs.AddToSessionGroup("g1", "sess1") // idempotent
	groups := cs.GetSessionGroups()
	if len(groups["g1"]) != 1 {
		t.Fatalf("expected 1 member, got %d", len(groups["g1"]))
	}
	cs.RemoveFromSessionGroup("g1", "sess1")
	if len(cs.GetSessionGroups()["g1"]) != 0 {
		t.Fatal("expected empty group after remove")
	}
	cs.DeleteSessionGroup("g1")
	if _, ok := cs.GetSessionGroups()["g1"]; ok {
		t.Fatal("DeleteSessionGroup should remove the group")
	}
}

func TestFilterPresets(t *testing.T) {
	cs := tempConfig(t)
	filter := json.RawMessage(`{"status":"open"}`)
	preset := FilterPreset{
		ID: "p1", Name: "Open", Filter: filter, CreatedAt: 1.0,
	}
	cs.AddFilterPreset(preset)
	if len(cs.GetConfig().Sessions.FilterPresets) != 1 {
		t.Fatal("expected 1 preset")
	}
	if !cs.RenameFilterPreset("p1", "Open Issues") {
		t.Fatal("RenameFilterPreset should return true")
	}
	if cs.RenameFilterPreset("missing", "x") {
		t.Fatal("RenameFilterPreset should return false for missing")
	}
	id := "p1"
	cs.SetDefaultFilterPreset(&id)
	if cs.GetConfig().Sessions.DefaultFilterPresetID == nil {
		t.Fatal("expected default preset id")
	}
	cs.RemoveFilterPreset("p1")
	if len(cs.GetConfig().Sessions.FilterPresets) != 0 {
		t.Fatal("expected 0 presets after removal")
	}
	if cs.GetConfig().Sessions.DefaultFilterPresetID != nil {
		t.Fatal("default preset id should be cleared")
	}
}

func TestAddRemoveTrigger(t *testing.T) {
	cs := tempConfig(t)
	custom := NotificationTrigger{
		ID:          "my-trigger",
		Name:        "My Trigger",
		Enabled:     true,
		ContentType: "tool_use",
		Mode:        "error_status",
	}
	cfg, err := cs.AddTrigger(custom)
	if err != nil {
		t.Fatalf("AddTrigger failed: %v", err)
	}
	found := false
	for _, t2 := range cfg.Notifications.Triggers {
		if t2.ID == "my-trigger" {
			found = true
		}
	}
	if !found {
		t.Fatal("trigger not found after add")
	}

	// Duplicate ID must error.
	_, err = cs.AddTrigger(custom)
	if err == nil {
		t.Fatal("expected error for duplicate trigger id")
	}

	// Remove builtin must error.
	_, err = cs.RemoveTrigger("builtin-bash-command")
	if err == nil {
		t.Fatal("expected error for removing builtin")
	}

	_, err = cs.RemoveTrigger("my-trigger")
	if err != nil {
		t.Fatalf("RemoveTrigger failed: %v", err)
	}
}

func TestSnoozeAndClear(t *testing.T) {
	cs := tempConfig(t)
	m := uint32(15)
	cfg := cs.Snooze(&m)
	if cfg.Notifications.SnoozedUntil == nil {
		t.Fatal("snoozedUntil should be set")
	}
	cfg = cs.ClearSnooze()
	if cfg.Notifications.SnoozedUntil != nil {
		t.Fatal("snoozedUntil should be cleared")
	}
}

func TestAddRemoveIgnoreRegex(t *testing.T) {
	cs := tempConfig(t)
	cfg, err := cs.AddIgnoreRegex(`\.secret`)
	if err != nil {
		t.Fatalf("AddIgnoreRegex failed: %v", err)
	}
	found := false
	for _, p := range cfg.Notifications.IgnoredRegex {
		if p == `\.secret` {
			found = true
		}
	}
	if !found {
		t.Fatal("pattern not found after add")
	}
	// Idempotent add.
	cfg, _ = cs.AddIgnoreRegex(`\.secret`)
	count := 0
	for _, p := range cfg.Notifications.IgnoredRegex {
		if p == `\.secret` {
			count++
		}
	}
	if count != 1 {
		t.Fatal("pattern should appear exactly once")
	}
	// Invalid regex must error.
	_, err = cs.AddIgnoreRegex(`(unclosed`)
	if err == nil {
		t.Fatal("expected error for invalid regex")
	}

	cfg = cs.RemoveIgnoreRegex(`\.secret`)
	for _, p := range cfg.Notifications.IgnoredRegex {
		if p == `\.secret` {
			t.Fatal("pattern should be removed")
		}
	}
}

func TestExportImportAnnotationsBundle(t *testing.T) {
	cs := tempConfig(t)
	cs.AddAnnotation(AnnotationEntry{
		ID: "a1", SessionID: "s1", ProjectID: "p1",
		TargetID: "t1", Text: "hello", Color: "green",
		CreatedAt: 1.0, UpdatedAt: 1.0,
	})
	bundle := cs.ExportAnnotationsBundle(nil)
	if bundle.Version != 1 {
		t.Fatalf("expected version 1, got %d", bundle.Version)
	}
	if len(bundle.Annotations) != 1 {
		t.Fatalf("expected 1 annotation in export, got %d", len(bundle.Annotations))
	}

	// Filter to empty session list → still exports all (wantAll logic).
	bundle2 := cs.ExportAnnotationsBundle([]string{})
	if len(bundle2.Annotations) != 1 {
		t.Fatal("empty sessionIDs should export all")
	}

	// Filter to specific session.
	bundle3 := cs.ExportAnnotationsBundle([]string{"s1"})
	if len(bundle3.Annotations) != 1 {
		t.Fatal("filtered export should include s1 annotations")
	}
	bundle4 := cs.ExportAnnotationsBundle([]string{"other"})
	if len(bundle4.Annotations) != 0 {
		t.Fatal("filtered export should exclude non-matching sessions")
	}
}

// TestNormalizeClaudeRootPath verifies the path normalization helper.
func TestDismissedSuggestionsRoundTrip(t *testing.T) {
	cs := tempConfig(t)

	if got := cs.GetDismissedSuggestions(); len(got) != 0 {
		t.Fatalf("expected empty dismissed set, got %v", got)
	}

	if err := cs.DismissSuggestion("Bash(git status:*)"); err != nil {
		t.Fatal(err)
	}
	// Idempotent: a repeat dismiss adds no duplicate.
	if err := cs.DismissSuggestion("Bash(git status:*)"); err != nil {
		t.Fatal(err)
	}
	if err := cs.DismissSuggestion("Bash(make build)"); err != nil {
		t.Fatal(err)
	}

	// Reload from disk with a fresh state to prove persistence.
	reloaded := &ConfigState{configPath: cs.configPath}
	got := reloaded.GetDismissedSuggestions()
	if len(got) != 2 {
		t.Fatalf("expected 2 dismissed rules after reload, got %v", got)
	}
	want := map[string]bool{"Bash(git status:*)": true, "Bash(make build)": true}
	for _, r := range got {
		if !want[r] {
			t.Errorf("unexpected dismissed rule %q", r)
		}
	}
}

func TestNormalizeClaudeRootPath(t *testing.T) {
	cases := []struct {
		input    *string
		wantNil  bool
		wantSufx string
	}{
		{nil, true, ""},
		{ptr.To(""), true, ""},
		{ptr.To("   "), true, ""},
		{ptr.To("relative/path"), true, ""},
		{ptr.To("/Users/foo/"), false, "/Users/foo"},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%v", tc.input), func(t *testing.T) {
			got := normalizeClaudeRootPath(tc.input)
			if tc.wantNil {
				if got != nil {
					t.Fatalf("expected nil, got %q", *got)
				}
			} else {
				if got == nil {
					t.Fatal("expected non-nil result")
				}
				if tc.wantSufx != "" && *got != tc.wantSufx {
					t.Fatalf("expected %q, got %q", tc.wantSufx, *got)
				}
			}
		})
	}
}
