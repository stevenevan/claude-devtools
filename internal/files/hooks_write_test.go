package files

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// hooksSeed has 2 events; PreToolUse has 2 groups. The Bash group carries an
// unknown field ("description") and a command containing "2>&1" and "&&" —
// both to prove MutateSettingsJSON's re-serialization preserves them at the
// decoded-value level (it HTML-escapes on write, so tests must parse-then-
// compare, never raw-byte-compare). The top-level "customKey" is an unknown
// key a real settings.json might carry that toggling must never touch.
const hooksSeed = `{
	"hooks": {
		"PreToolUse": [
			{
				"matcher": "Bash",
				"description": "logs bash commands before execution",
				"hooks": [
					{ "type": "command", "command": "echo start && ./run.sh 2>&1 | tee -a log.txt" }
				]
			},
			{
				"matcher": "Write",
				"hooks": [
					{ "type": "command", "command": "echo writing" }
				]
			}
		],
		"SessionStart": [
			{
				"matcher": "*",
				"hooks": [
					{ "type": "command", "command": "echo session start" }
				]
			}
		]
	},
	"customKey": { "nested": "value", "count": 3 },
	"theme": "dark"
}`

// seedHooksSettings points HOME at a fresh temp dir, seeds settings.json
// with hooksSeed, and returns the HOME/.claude dir and settings.json path.
func seedHooksSettings(t *testing.T) (dir, settingsFile string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	dir = filepath.Join(home, ".claude")
	settingsFile = filepath.Join(dir, "settings.json")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(settingsFile, []byte(hooksSeed), 0o644); err != nil {
		t.Fatalf("write seed settings.json: %v", err)
	}
	return dir, settingsFile
}

func readJSONMap(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return m
}

func findEntry(t *testing.T, entries []HookEntry, event, matcher string) HookEntry {
	t.Helper()
	for _, e := range entries {
		if e.Event == event && e.Matcher == matcher {
			return e
		}
	}
	t.Fatalf("entry not found: event=%s matcher=%s (have %+v)", event, matcher, entries)
	return HookEntry{}
}

func groupsByMatcher(t *testing.T, groups []any, matcher string) map[string]any {
	t.Helper()
	for _, g := range groups {
		gm, ok := g.(map[string]any)
		if !ok {
			continue
		}
		if gm["matcher"] == matcher {
			return gm
		}
	}
	t.Fatalf("group with matcher %q not found in %v", matcher, groups)
	return nil
}

func TestHooksToggleDisableEnableRoundTripPreservesCommandsAndUnknownFields(t *testing.T) {
	_, settingsFile := seedHooksSettings(t)
	appDataDir := t.TempDir()

	before, err := ReadHooks(appDataDir)
	if err != nil {
		t.Fatalf("ReadHooks: %v", err)
	}
	target := findEntry(t, before.Enabled, "PreToolUse", "Bash")

	if err := ToggleHook(appDataDir, target.Event, target.Index, target.Fingerprint, false); err != nil {
		t.Fatalf("disable: %v", err)
	}

	afterDisable, err := ReadHooks(appDataDir)
	if err != nil {
		t.Fatalf("ReadHooks after disable: %v", err)
	}
	disabledEntry := findEntry(t, afterDisable.Disabled, "PreToolUse", "Bash")

	if err := ToggleHook(appDataDir, disabledEntry.Event, disabledEntry.Index, disabledEntry.Fingerprint, true); err != nil {
		t.Fatalf("enable: %v", err)
	}

	settings := readJSONMap(t, settingsFile)
	hooks := settings["hooks"].(map[string]any)
	preToolUse := hooks["PreToolUse"].([]any)
	restored := groupsByMatcher(t, preToolUse, "Bash")

	if restored["description"] != "logs bash commands before execution" {
		t.Errorf("unknown group field not preserved: %v", restored["description"])
	}

	restoredCommands := restored["hooks"].([]any)
	gotCmd := restoredCommands[0].(map[string]any)["command"]
	wantCmd := "echo start && ./run.sh 2>&1 | tee -a log.txt"
	if gotCmd != wantCmd {
		t.Errorf("command = %q, want %q", gotCmd, wantCmd)
	}

	wantCustom := map[string]any{"nested": "value", "count": float64(3)}
	if !reflect.DeepEqual(settings["customKey"], wantCustom) {
		t.Errorf("unknown top-level key not preserved: %v", settings["customKey"])
	}
}

func TestHooksToggleDisableRemovesFromSettingsAddsToDisabled(t *testing.T) {
	_, settingsFile := seedHooksSettings(t)
	appDataDir := t.TempDir()

	before, err := ReadHooks(appDataDir)
	if err != nil {
		t.Fatalf("ReadHooks: %v", err)
	}
	target := findEntry(t, before.Enabled, "PreToolUse", "Bash")

	if err := ToggleHook(appDataDir, target.Event, target.Index, target.Fingerprint, false); err != nil {
		t.Fatalf("disable: %v", err)
	}

	settings := readJSONMap(t, settingsFile)
	hooks := settings["hooks"].(map[string]any)
	preToolUse := hooks["PreToolUse"].([]any)
	if len(preToolUse) != 1 {
		t.Fatalf("PreToolUse length = %d, want 1", len(preToolUse))
	}
	if preToolUse[0].(map[string]any)["matcher"] == "Bash" {
		t.Fatal("Bash group still present in settings.json after disable")
	}

	disabled := readJSONMap(t, filepath.Join(appDataDir, "hooks-disabled.json"))
	disabledPreToolUse, ok := disabled["PreToolUse"].([]any)
	if !ok || len(disabledPreToolUse) != 1 {
		t.Fatalf("hooks-disabled.json PreToolUse = %v", disabled["PreToolUse"])
	}
	if disabledPreToolUse[0].(map[string]any)["matcher"] != "Bash" {
		t.Errorf("disabled group matcher = %v, want Bash", disabledPreToolUse[0].(map[string]any)["matcher"])
	}
}

func TestHooksToggleEnableRemovesFromDisabledAddsToSettings(t *testing.T) {
	_, settingsFile := seedHooksSettings(t)
	appDataDir := t.TempDir()

	before, err := ReadHooks(appDataDir)
	if err != nil {
		t.Fatalf("ReadHooks: %v", err)
	}
	target := findEntry(t, before.Enabled, "PreToolUse", "Bash")
	if err := ToggleHook(appDataDir, target.Event, target.Index, target.Fingerprint, false); err != nil {
		t.Fatalf("disable: %v", err)
	}

	afterDisable, err := ReadHooks(appDataDir)
	if err != nil {
		t.Fatalf("ReadHooks after disable: %v", err)
	}
	disabledEntry := findEntry(t, afterDisable.Disabled, "PreToolUse", "Bash")
	if err := ToggleHook(appDataDir, disabledEntry.Event, disabledEntry.Index, disabledEntry.Fingerprint, true); err != nil {
		t.Fatalf("enable: %v", err)
	}

	settings := readJSONMap(t, settingsFile)
	hooks := settings["hooks"].(map[string]any)
	preToolUse := hooks["PreToolUse"].([]any)
	if len(preToolUse) != 2 {
		t.Fatalf("PreToolUse length = %d, want 2", len(preToolUse))
	}
	groupsByMatcher(t, preToolUse, "Bash") // fatals if absent

	disabled := readJSONMap(t, filepath.Join(appDataDir, "hooks-disabled.json"))
	if remaining, ok := disabled["PreToolUse"].([]any); ok && len(remaining) != 0 {
		t.Errorf("hooks-disabled.json PreToolUse not emptied: %v", remaining)
	}
}

func TestHooksToggleUnrelatedSettingsKeysPreserved(t *testing.T) {
	_, settingsFile := seedHooksSettings(t)
	appDataDir := t.TempDir()

	before, err := ReadHooks(appDataDir)
	if err != nil {
		t.Fatalf("ReadHooks: %v", err)
	}
	target := findEntry(t, before.Enabled, "PreToolUse", "Write")
	if err := ToggleHook(appDataDir, target.Event, target.Index, target.Fingerprint, false); err != nil {
		t.Fatalf("disable: %v", err)
	}

	settings := readJSONMap(t, settingsFile)
	if settings["theme"] != "dark" {
		t.Errorf("theme not preserved: %v", settings["theme"])
	}
	wantCustom := map[string]any{"nested": "value", "count": float64(3)}
	if !reflect.DeepEqual(settings["customKey"], wantCustom) {
		t.Errorf("customKey not preserved: %v", settings["customKey"])
	}

	hooks := settings["hooks"].(map[string]any)
	sessionStart := hooks["SessionStart"].([]any)
	if len(sessionStart) != 1 {
		t.Fatalf("SessionStart unexpectedly changed: %v", sessionStart)
	}
	cmd := sessionStart[0].(map[string]any)["hooks"].([]any)[0].(map[string]any)["command"]
	if cmd != "echo session start" {
		t.Errorf("SessionStart command changed: %v", cmd)
	}
}

func TestHooksToggleFingerprintMismatchErrorsNoWrite(t *testing.T) {
	_, settingsFile := seedHooksSettings(t)
	appDataDir := t.TempDir()

	beforeRaw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("read settings.json: %v", err)
	}

	if err := ToggleHook(appDataDir, "PreToolUse", 0, "deadbeefdeadbeef", false); err == nil {
		t.Fatal("expected error for fingerprint mismatch, got nil")
	}

	afterRaw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("read settings.json after: %v", err)
	}
	if string(beforeRaw) != string(afterRaw) {
		t.Error("settings.json changed despite fingerprint mismatch")
	}
	if _, err := os.Stat(filepath.Join(appDataDir, "hooks-disabled.json")); !os.IsNotExist(err) {
		t.Errorf("hooks-disabled.json should not exist, stat err = %v", err)
	}
}

func TestHooksToggleOutOfRangeIndexErrorsNoPanic(t *testing.T) {
	_, settingsFile := seedHooksSettings(t)
	appDataDir := t.TempDir()

	beforeRaw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("read settings.json: %v", err)
	}

	if err := ToggleHook(appDataDir, "PreToolUse", 99, "irrelevant", false); err == nil {
		t.Fatal("expected error for out-of-range index, got nil")
	}
	if err := ToggleHook(appDataDir, "PreToolUse", -1, "irrelevant", false); err == nil {
		t.Fatal("expected error for negative index, got nil")
	}
	// Enable side, sourced from a hooks-disabled.json that doesn't exist yet.
	if err := ToggleHook(appDataDir, "PreToolUse", 0, "irrelevant", true); err == nil {
		t.Fatal("expected error for out-of-range index on enable (no disabled file), got nil")
	}

	afterRaw, err := os.ReadFile(settingsFile)
	if err != nil {
		t.Fatalf("read settings.json after: %v", err)
	}
	if string(beforeRaw) != string(afterRaw) {
		t.Error("settings.json changed despite out-of-range index")
	}
}
