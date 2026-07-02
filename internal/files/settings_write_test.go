package files

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// settingsPaths sets HOME to a fresh temp dir and returns the paths
// UpdateGlobalSettings reads/writes under it.
func settingsPaths(t *testing.T) (dir, settingsFile, bakFile, tmpFile string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	dir = filepath.Join(home, ".claude")
	settingsFile = filepath.Join(dir, "settings.json")
	bakFile = settingsFile + ".bak"
	tmpFile = settingsFile + ".tmp"
	return dir, settingsFile, bakFile, tmpFile
}

func writeSettingsFile(t *testing.T, dir, path, content string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write seed file: %v", err)
	}
}

func TestUpdateGlobalSettingsRoundTripPreservesUnrelatedKeys(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	seed := `{
		"$schema": "https://example.com/schema.json",
		"theme": "dark",
		"permissions": {
			"defaultMode": "acceptEdits",
			"allow": ["Bash(ls:*)"]
		}
	}`
	writeSettingsFile(t, dir, settingsFile, seed)

	err := UpdateGlobalSettings(SettingsPatch{
		Env:   map[string]string{"FOO": "bar"},
		Allow: []string{"Bash(rm:*)"},
	})
	if err != nil {
		t.Fatalf("UpdateGlobalSettings: %v", err)
	}

	var got map[string]any
	raw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("read settings.json: %v", err)
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("parse settings.json: %v", err)
	}

	if got["$schema"] != "https://example.com/schema.json" {
		t.Errorf("$schema not preserved: %v", got["$schema"])
	}
	if got["theme"] != "dark" {
		t.Errorf("theme not preserved: %v", got["theme"])
	}
	env, ok := got["env"].(map[string]any)
	if !ok || env["FOO"] != "bar" {
		t.Errorf("env not applied: %v", got["env"])
	}
	perms, ok := got["permissions"].(map[string]any)
	if !ok {
		t.Fatalf("permissions missing or wrong type: %v", got["permissions"])
	}
	if perms["defaultMode"] != "acceptEdits" {
		t.Errorf("permissions.defaultMode not preserved: %v", perms["defaultMode"])
	}
	allow, ok := perms["allow"].([]any)
	if !ok || len(allow) != 1 || allow[0] != "Bash(rm:*)" {
		t.Errorf("permissions.allow not applied: %v", perms["allow"])
	}
}

func TestUpdateGlobalSettingsBackupHoldsOldContent(t *testing.T) {
	dir, settingsFile, bakFile, _ := settingsPaths(t)
	seed := `{"theme": "dark"}`
	writeSettingsFile(t, dir, settingsFile, seed)

	if err := UpdateGlobalSettings(SettingsPatch{Env: map[string]string{"A": "1"}}); err != nil {
		t.Fatalf("UpdateGlobalSettings: %v", err)
	}

	bakRaw, err := os.ReadFile(bakFile)
	if err != nil {
		t.Fatalf("read .bak: %v", err)
	}
	if string(bakRaw) != seed {
		t.Errorf(".bak content = %q, want %q", bakRaw, seed)
	}
}

func TestUpdateGlobalSettingsMissingFileCreatesValidFileNoBackup(t *testing.T) {
	_, settingsFile, bakFile, _ := settingsPaths(t)

	if err := UpdateGlobalSettings(SettingsPatch{Env: map[string]string{"A": "1"}}); err != nil {
		t.Fatalf("UpdateGlobalSettings: %v", err)
	}

	raw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("settings.json not created: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("settings.json not valid JSON: %v", err)
	}

	if _, err := os.Stat(bakFile); !os.IsNotExist(err) {
		t.Errorf("expected no .bak for missing-file case, stat err = %v", err)
	}
}

func TestUpdateGlobalSettingsCorruptFileErrorsAndLeavesFileUnchanged(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	corrupt := `{not valid json`
	writeSettingsFile(t, dir, settingsFile, corrupt)

	err := UpdateGlobalSettings(SettingsPatch{Env: map[string]string{"A": "1"}})
	if err == nil {
		t.Fatal("expected error for corrupt settings.json, got nil")
	}

	raw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("settings.json disappeared: %v", err)
	}
	if string(raw) != corrupt {
		t.Errorf("settings.json content changed: %q", raw)
	}
}

func TestUpdateGlobalSettingsInvalidEnvKeyErrorsAndLeavesFileUnchanged(t *testing.T) {
	dir, settingsFile, bakFile, _ := settingsPaths(t)
	seed := `{"theme": "dark"}`
	writeSettingsFile(t, dir, settingsFile, seed)

	err := UpdateGlobalSettings(SettingsPatch{Env: map[string]string{"BAD KEY=x": "1"}})
	if err == nil {
		t.Fatal("expected error for invalid env key, got nil")
	}

	raw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("settings.json disappeared: %v", err)
	}
	if string(raw) != seed {
		t.Errorf("settings.json content changed: %q", raw)
	}

	if _, err := os.Stat(bakFile); !os.IsNotExist(err) {
		t.Errorf("expected no .bak for invalid-env-key case, stat err = %v", err)
	}
}

func TestUpdateGlobalSettingsNoTmpFileLeftAfterSuccess(t *testing.T) {
	_, _, _, tmpFile := settingsPaths(t)

	if err := UpdateGlobalSettings(SettingsPatch{Env: map[string]string{"A": "1"}}); err != nil {
		t.Fatalf("UpdateGlobalSettings: %v", err)
	}

	if _, err := os.Stat(tmpFile); !os.IsNotExist(err) {
		t.Errorf("expected no .tmp file left behind, stat err = %v", err)
	}
}

func TestUpdateGlobalSettingsSurvivesExternalEditBetweenUpdates(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	seed := `{"theme": "dark"}`
	writeSettingsFile(t, dir, settingsFile, seed)

	if err := UpdateGlobalSettings(SettingsPatch{Env: map[string]string{"A": "1"}}); err != nil {
		t.Fatalf("first UpdateGlobalSettings: %v", err)
	}

	// Simulate the CLI editing settings.json between the two app saves.
	raw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("read settings.json: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("parse settings.json: %v", err)
	}
	m["externallyAdded"] = "from-cli"
	raw2, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(settingsFile, raw2, 0o644); err != nil {
		t.Fatalf("write externally-edited settings.json: %v", err)
	}

	if err := UpdateGlobalSettings(SettingsPatch{Env: map[string]string{"B": "2"}}); err != nil {
		t.Fatalf("second UpdateGlobalSettings: %v", err)
	}

	raw3, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("read settings.json: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw3, &got); err != nil {
		t.Fatalf("parse settings.json: %v", err)
	}
	if got["externallyAdded"] != "from-cli" {
		t.Errorf("externally added key lost: %v", got["externallyAdded"])
	}
	env, ok := got["env"].(map[string]any)
	if !ok || env["B"] != "2" {
		t.Errorf("second update's env not applied: %v", got["env"])
	}
}
