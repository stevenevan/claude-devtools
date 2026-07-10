package files

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	fixtureEmail = "user@example.com"
	fixtureToken = "sk-live-secrettoken"
)

// claudeJSONHome sets HOME to a fresh temp dir, creates ~/.claude/{projects,
// backups}, and returns the home path. All claude.json helpers resolve HOME.
func claudeJSONHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	for _, d := range []string{
		filepath.Join(home, ".claude", "projects"),
		filepath.Join(home, ".claude", "backups"),
	} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir %q: %v", d, err)
		}
	}
	return home
}

func writeClaudeJSON(t *testing.T, home string, content map[string]any) {
	t.Helper()
	data, err := json.Marshal(content)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), data, 0o644); err != nil {
		t.Fatalf("write .claude.json: %v", err)
	}
}

// fixtureContent builds a claude.json fixture with a live-on-disk project plus
// stale / unverifiable / cross-referenced-live entries.
func fixtureContent(home, liveOnDisk string) map[string]any {
	return map[string]any{
		"numStartups": 2543,
		"theme":       "dark",
		"helper":      fixtureToken, // benign key name, secret-shaped value
		"oauthAccount": map[string]any{
			"emailAddress": fixtureEmail,
			"accountUuid":  "uuid-1234",
		},
		"hasSeenTasksHint": true,
		"cachedChangelog":  "v1.2.3 notes",
		"projects": map[string]any{
			liveOnDisk:               map[string]any{"allowedTools": []any{"Bash"}, "hasTrustDialogAccepted": true},
			"/zzz_stale_project_dir": map[string]any{"allowedTools": []any{}},
			"/zzz-unverifiable-dir":  map[string]any{"history": []any{}},
			"/zzz/livehist/projectx": map[string]any{"allowedTools": []any{}},
		},
	}
}

func TestReadClaudeJSONCensus(t *testing.T) {
	home := claudeJSONHome(t)
	liveOnDisk := filepath.Join(home, "liveworkdir")
	if err := os.MkdirAll(liveOnDisk, 0o755); err != nil {
		t.Fatalf("mkdir live: %v", err)
	}
	// Encoded projects/ dir that decodes to a hyphen-free, on-disk-absent path.
	if err := os.MkdirAll(filepath.Join(home, ".claude", "projects", "-zzz-livehist-projectx"), 0o755); err != nil {
		t.Fatalf("mkdir encoded: %v", err)
	}
	writeClaudeJSON(t, home, fixtureContent(home, liveOnDisk))

	census, err := ReadClaudeJSON()
	if err != nil {
		t.Fatalf("ReadClaudeJSON: %v", err)
	}

	topByName := indexKeys(census.TopLevel)
	flagsByName := indexKeys(census.Flags)

	if _, ok := topByName["projects"]; ok {
		t.Error("projects must not appear in TopLevel")
	}
	for _, flag := range []string{"hasSeenTasksHint", "cachedChangelog"} {
		if _, ok := flagsByName[flag]; !ok {
			t.Errorf("flag %q missing from Flags group", flag)
		}
		if _, ok := topByName[flag]; ok {
			t.Errorf("flag %q leaked into TopLevel", flag)
		}
	}

	if got := topByName["oauthAccount"]; !got.Secret {
		t.Error("oauthAccount must be flagged secret (key match)")
	} else if got.Kind != "object" {
		t.Errorf("oauthAccount kind = %q, want object", got.Kind)
	}
	if got := topByName["helper"]; !got.Secret {
		t.Error("helper must be flagged secret (value shape match)")
	}
	if got := topByName["theme"]; got.Secret {
		t.Error("theme must not be flagged secret")
	} else if got.Kind != "string" {
		t.Errorf("theme kind = %q, want string", got.Kind)
	}
	if got := topByName["numStartups"]; got.Kind != "number" {
		t.Errorf("numStartups kind = %q, want number", got.Kind)
	}

	triage := map[string]string{}
	for _, p := range census.Projects {
		triage[p.Path] = p.Triage
	}
	wantTriage := map[string]string{
		liveOnDisk:               triageLive,
		"/zzz_stale_project_dir": triageStale,
		"/zzz-unverifiable-dir":  triageUnverifiable,
		"/zzz/livehist/projectx": triageLive,
	}
	for path, want := range wantTriage {
		if got := triage[path]; got != want {
			t.Errorf("triage[%q] = %q, want %q", path, got, want)
		}
	}
}

func indexKeys(keys []ClaudeJSONKey) map[string]ClaudeJSONKey {
	m := make(map[string]ClaudeJSONKey, len(keys))
	for _, k := range keys {
		m[k.Name] = k
	}
	return m
}

func TestRevealClaudeJSONValue(t *testing.T) {
	home := claudeJSONHome(t)
	writeClaudeJSON(t, home, fixtureContent(home, filepath.Join(home, "liveworkdir")))

	got, err := RevealClaudeJSONValue("theme")
	if err != nil {
		t.Fatalf("reveal theme: %v", err)
	}
	if got != `"dark"` {
		t.Errorf("reveal theme = %q, want %q", got, `"dark"`)
	}

	// Secret-matched key: reveal must return the mask, never the raw blob.
	oauth, err := RevealClaudeJSONValue("oauthAccount")
	if err != nil {
		t.Fatalf("reveal oauthAccount: %v", err)
	}
	if strings.Contains(oauth, fixtureEmail) {
		t.Errorf("reveal oauthAccount leaked email: %q", oauth)
	}
	if !strings.Contains(oauth, claudeJSONMask) {
		t.Errorf("reveal oauthAccount not masked: %q", oauth)
	}

	// Secret-shaped value under a benign key: masked too.
	helper, err := RevealClaudeJSONValue("helper")
	if err != nil {
		t.Fatalf("reveal helper: %v", err)
	}
	if strings.Contains(helper, fixtureToken) {
		t.Errorf("reveal helper leaked token: %q", helper)
	}

	if _, err := RevealClaudeJSONValue("nope"); err == nil {
		t.Error("reveal of missing key must error")
	}
}

func TestReadClaudeJSONMasked(t *testing.T) {
	home := claudeJSONHome(t)
	writeClaudeJSON(t, home, fixtureContent(home, filepath.Join(home, "liveworkdir")))

	masked, err := ReadClaudeJSONMasked()
	if err != nil {
		t.Fatalf("ReadClaudeJSONMasked: %v", err)
	}
	if strings.Contains(masked, fixtureEmail) || strings.Contains(masked, fixtureToken) {
		t.Errorf("masked live read leaked secrets: %q", masked)
	}
	if !strings.Contains(masked, claudeJSONMask) {
		t.Errorf("masked live read not masked: %q", masked)
	}
	if !strings.Contains(masked, "dark") {
		t.Errorf("masked live read dropped non-secret value: %q", masked)
	}
}

func TestReadClaudeJSONRetryError(t *testing.T) {
	t.Run("missing_file", func(t *testing.T) {
		claudeJSONHome(t) // no .claude.json written
		_, err := ReadClaudeJSON()
		if err == nil {
			t.Fatal("expected error for missing file")
		}
		assertTryAgain(t, err)
	})

	t.Run("invalid_json", func(t *testing.T) {
		home := claudeJSONHome(t)
		if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte("{not valid"), 0o644); err != nil {
			t.Fatalf("write invalid: %v", err)
		}
		_, err := ReadClaudeJSON()
		if err == nil {
			t.Fatal("expected error for invalid JSON")
		}
		assertTryAgain(t, err)
	})
}

func assertTryAgain(t *testing.T, err error) {
	t.Helper()
	msg := strings.ToLower(err.Error())
	if !strings.Contains(msg, "try again") {
		t.Errorf("error should say 'try again', got %q", err)
	}
	if strings.Contains(msg, "corrupt") || strings.Contains(msg, "repair") {
		t.Errorf("error must never say corrupt/repair, got %q", err)
	}
}

func TestClaudeJSONBackups(t *testing.T) {
	home := claudeJSONHome(t)
	backupsDir := filepath.Join(home, ".claude", "backups")
	backupContent := map[string]any{
		"helper": fixtureToken,
		"oauthAccount": map[string]any{
			"emailAddress": fixtureEmail,
		},
		"theme": "dark",
	}
	data, err := json.Marshal(backupContent)
	if err != nil {
		t.Fatalf("marshal backup: %v", err)
	}
	names := []string{".claude.json.backup.1783695046813", ".claude.json.backup.1783698012205"}
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(backupsDir, name), data, 0o644); err != nil {
			t.Fatalf("write backup %q: %v", name, err)
		}
	}
	// Non-backup sibling must be ignored by enumeration.
	if err := os.WriteFile(filepath.Join(backupsDir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write sibling: %v", err)
	}

	backups, err := ListClaudeJSONBackups()
	if err != nil {
		t.Fatalf("ListClaudeJSONBackups: %v", err)
	}
	if len(backups) != 2 {
		t.Fatalf("want 2 backups, got %d", len(backups))
	}

	masked, err := ReadClaudeJSONBackup(names[0])
	if err != nil {
		t.Fatalf("ReadClaudeJSONBackup: %v", err)
	}
	if strings.Contains(masked, fixtureEmail) || strings.Contains(masked, fixtureToken) {
		t.Errorf("backup read leaked secrets: %q", masked)
	}
	if !strings.Contains(masked, claudeJSONMask) {
		t.Errorf("backup read not masked: %q", masked)
	}
	if !strings.Contains(masked, "dark") {
		t.Errorf("backup read dropped non-secret value: %q", masked)
	}
}

func TestReadClaudeJSONBackupRejectsBadNames(t *testing.T) {
	claudeJSONHome(t)
	bad := []string{
		"",
		"..",
		".",
		"../../../etc/passwd",
		"evil.txt",
		"foo/.claude.json.backup.1",
		"..claude.json.backup.1", // contains ".."
		".claude.json.backup",    // missing timestamp suffix
	}
	for _, name := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := ReadClaudeJSONBackup(name); err == nil {
				t.Errorf("expected ReadClaudeJSONBackup(%q) to be rejected", name)
			}
		})
	}
}
