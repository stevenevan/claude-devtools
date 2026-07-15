package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestDefaultRetentionSeeded asserts the default policy seeds the 15
// trash-governed matchers + "history" (enabled, not auto-approved) and NEVER
// the plain-delete ids {logs, logs-daemon, caches} (Architect HIGH-1).
func TestDefaultRetentionSeeded(t *testing.T) {
	p := DefaultAppConfig().Retention
	if p.TrashExpiryDays != 30 {
		t.Fatalf("default trashExpiryDays: got %d want 30", p.TrashExpiryDays)
	}
	if len(p.Categories) != 16 {
		t.Fatalf("want 16 seeded categories (15 trash-governed + history), got %d", len(p.Categories))
	}
	for _, id := range []string{"transcripts", "plans", "history", "runtime-tasks"} {
		c, ok := p.Categories[id]
		if !ok || !c.Enabled || c.AutoApproved {
			t.Errorf("category %q should be seeded enabled/not-auto-approved, got %+v (present=%v)", id, c, ok)
		}
	}
	for _, id := range []string{"logs", "logs-daemon", "caches"} {
		if _, ok := p.Categories[id]; ok {
			t.Errorf("plain-delete id %q must NOT be seeded into the policy", id)
		}
	}
}

// TestRetentionPolicyRoundTrip asserts a policy survives Set → Get unchanged.
func TestRetentionPolicyRoundTrip(t *testing.T) {
	cs := tempConfig(t)
	in := RetentionPolicy{
		Categories: map[string]RetentionCategory{
			"transcripts": {Enabled: false, AutoApproved: true},
			"plans":       {Enabled: true, AutoApproved: false},
		},
		TrashExpiryDays: 45,
	}
	if err := cs.SetRetentionPolicy(in); err != nil {
		t.Fatal(err)
	}
	got := cs.GetRetentionPolicy()
	if got.TrashExpiryDays != 45 {
		t.Errorf("trashExpiryDays: got %d want 45", got.TrashExpiryDays)
	}
	if got.Categories["transcripts"] != (RetentionCategory{Enabled: false, AutoApproved: true}) {
		t.Errorf("transcripts round-trip wrong: %+v", got.Categories["transcripts"])
	}
	if got.Categories["plans"] != (RetentionCategory{Enabled: true}) {
		t.Errorf("plans round-trip wrong: %+v", got.Categories["plans"])
	}
}

// TestSetRetentionPolicyClampsExpiry asserts a 0/negative window is clamped to
// >=1 so an unattended run can't EmptyTrash same-pass receipts (Security F5).
func TestSetRetentionPolicyClampsExpiry(t *testing.T) {
	cs := tempConfig(t)
	for _, days := range []int{0, -5, -100000} {
		if err := cs.SetRetentionPolicy(RetentionPolicy{TrashExpiryDays: days}); err != nil {
			t.Fatal(err)
		}
		if got := cs.GetRetentionPolicy().TrashExpiryDays; got < 1 {
			t.Errorf("expiry %d must clamp to >=1, got %d", days, got)
		}
	}
	// A too-large value clamps to the ceiling, not past it.
	if err := cs.SetRetentionPolicy(RetentionPolicy{TrashExpiryDays: 999999}); err != nil {
		t.Fatal(err)
	}
	if got := cs.GetRetentionPolicy().TrashExpiryDays; got != 36500 {
		t.Errorf("expiry ceiling: got %d want 36500", got)
	}
}

// TestGetRetentionPolicyIsCopy asserts a returned policy does not alias the
// stored map (mutating it must not corrupt config state).
func TestGetRetentionPolicyIsCopy(t *testing.T) {
	cs := tempConfig(t)
	got := cs.GetRetentionPolicy()
	got.Categories["transcripts"] = RetentionCategory{Enabled: false}
	if !cs.GetRetentionPolicy().Categories["transcripts"].Enabled {
		t.Error("mutating a returned policy corrupted stored config")
	}
}

// TestLastCleanupMsRoundTrip asserts the app's own last-run timestamp persists.
func TestLastCleanupMsRoundTrip(t *testing.T) {
	cs := tempConfig(t)
	if cs.GetLastCleanupMs() != 0 {
		t.Fatalf("default last-cleanup should be 0, got %v", cs.GetLastCleanupMs())
	}
	if err := cs.SetLastCleanupMs(1234.5); err != nil {
		t.Fatal(err)
	}
	if got := cs.GetLastCleanupMs(); got != 1234.5 {
		t.Errorf("last-cleanup: got %v want 1234.5", got)
	}
}

// TestRetentionMergeOnLoad asserts a partial/hand-edited stored policy is filled
// with default categories and its window normalized (0 → default, negative →
// clamped) — never trusting a smuggled 0/negative (Security F5).
func TestRetentionMergeOnLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	raw := `{"retention":{"trashExpiryDays":-10,"categories":{"transcripts":{"enabled":false,"autoApproved":true}}}}`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := loadConfigFromDisk(path)

	if cfg.Retention.TrashExpiryDays != 1 {
		t.Errorf("negative window must clamp to 1, got %d", cfg.Retention.TrashExpiryDays)
	}
	if c := cfg.Retention.Categories["transcripts"]; c.Enabled || !c.AutoApproved {
		t.Errorf("stored transcripts toggles must be preserved, got %+v", c)
	}
	if !cfg.Retention.Categories["plans"].Enabled {
		t.Error("missing default category (plans) must be filled on load")
	}
	if len(cfg.Retention.Categories) != 16 {
		t.Errorf("merged policy should hold all 16 default ids, got %d", len(cfg.Retention.Categories))
	}
	if _, ok := cfg.Retention.Categories["logs"]; ok {
		t.Error("plain-delete id must not appear after merge")
	}

	// A zero window (missing key) falls back to the default, not the [1] floor.
	raw0 := `{"retention":{"trashExpiryDays":0}}`
	if err := os.WriteFile(path, []byte(raw0), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := loadConfigFromDisk(path).Retention.TrashExpiryDays; got != 30 {
		t.Errorf("zero window should fall back to default 30, got %d", got)
	}
}

// TestValidateRetentionClampsExpiry asserts the update validator clamps the
// window in the canonicalized JSON (Security F5) and rejects unknown keys.
func TestValidateRetentionClampsExpiry(t *testing.T) {
	clampedTo := func(input string) int {
		_, out, err := ValidateConfigUpdate("retention", json.RawMessage(input))
		if err != nil {
			t.Fatalf("validate %q: %v", input, err)
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(out, &m); err != nil {
			t.Fatal(err)
		}
		var d int
		if err := json.Unmarshal(m["trashExpiryDays"], &d); err != nil {
			t.Fatal(err)
		}
		return d
	}
	if got := clampedTo(`{"trashExpiryDays":0}`); got != 1 {
		t.Errorf("0 must clamp to 1, got %d", got)
	}
	if got := clampedTo(`{"trashExpiryDays":-9}`); got != 1 {
		t.Errorf("negative must clamp to 1, got %d", got)
	}
	if got := clampedTo(`{"trashExpiryDays":45}`); got != 45 {
		t.Errorf("valid value must pass through, got %d", got)
	}

	if _, _, err := ValidateConfigUpdate("retention", json.RawMessage(`{"bogus":1}`)); err == nil {
		t.Error("unknown retention key must be rejected")
	}
}

// TestUpdateConfigRetentionSection asserts the section switch persists a
// retention update and clamps its window end-to-end.
func TestUpdateConfigRetentionSection(t *testing.T) {
	cs := tempConfig(t)
	body := `{"trashExpiryDays":0,"categories":{"plans":{"enabled":false,"autoApproved":false}}}`
	if _, err := cs.UpdateConfig("retention", json.RawMessage(body)); err != nil {
		t.Fatal(err)
	}
	got := cs.GetRetentionPolicy()
	if got.TrashExpiryDays != 1 {
		t.Errorf("update must clamp window to 1, got %d", got.TrashExpiryDays)
	}
	if got.Categories["plans"].Enabled {
		t.Error("update must persist plans.enabled=false")
	}
}
