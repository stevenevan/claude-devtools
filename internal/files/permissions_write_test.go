package files

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// permissionsFixture sets HOME to a fresh temp dir (seeding global
// settings.json permissions) and returns a temp projectRoot seeded with
// .claude/settings.json (committed project, display-only) and
// .claude/settings.local.json (project-local, writable).
func permissionsFixture(t *testing.T) (home, projectRoot string) {
	t.Helper()
	home = t.TempDir()
	t.Setenv("HOME", home)
	projectRoot = t.TempDir()

	globalDir := filepath.Join(home, ".claude")
	writeSettingsFile(t, globalDir, filepath.Join(globalDir, "settings.json"), `{
		"permissions": {"defaultMode": "acceptEdits", "allow": ["Bash(ls:*)"], "deny": ["Bash(rm:*)"]}
	}`)

	projectDir := filepath.Join(projectRoot, ".claude")
	writeSettingsFile(t, projectDir, filepath.Join(projectDir, "settings.json"), `{
		"permissions": {"allow": ["Read(*)"]}
	}`)
	writeSettingsFile(t, projectDir, filepath.Join(projectDir, "settings.local.json"), `{
		"permissions": {"ask": ["Bash(git:*)"]}
	}`)

	return home, projectRoot
}

func findRule(rows []PermissionRuleRow, rule string) (PermissionRuleRow, bool) {
	for _, r := range rows {
		if r.Rule == rule {
			return r, true
		}
	}
	return PermissionRuleRow{}, false
}

func readPermissionList(t *testing.T, path, list string) []string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	perms, _ := m["permissions"].(map[string]any)
	arr, _ := perms[list].([]any)
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func containsStr(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func TestGetPermissionRulesThreeSources(t *testing.T) {
	home, projectRoot := permissionsFixture(t)

	view, err := GetPermissionRules(projectRoot)
	if err != nil {
		t.Fatalf("GetPermissionRules: %v", err)
	}

	globalSettings := filepath.Join(home, ".claude", "settings.json")
	projectSettings := filepath.Join(projectRoot, ".claude", "settings.json")
	projectLocal := filepath.Join(projectRoot, ".claude", "settings.local.json")

	cases := []struct {
		rule       string
		list       string
		sourceKind string
		sourcePath string
		writable   bool
	}{
		{"Bash(ls:*)", PermAllow, KindGlobal, globalSettings, true},
		{"Bash(rm:*)", PermDeny, KindGlobal, globalSettings, true},
		{"Read(*)", PermAllow, KindProject, projectSettings, false},
		{"Bash(git:*)", PermAsk, KindProjectLocal, projectLocal, true},
	}
	for _, c := range cases {
		row, ok := findRule(view.Rows, c.rule)
		if !ok {
			t.Errorf("rule %q missing from rows", c.rule)
			continue
		}
		if row.List != c.list {
			t.Errorf("rule %q List = %q, want %q", c.rule, row.List, c.list)
		}
		if row.SourceKind != c.sourceKind {
			t.Errorf("rule %q SourceKind = %q, want %q", c.rule, row.SourceKind, c.sourceKind)
		}
		if row.SourcePath != c.sourcePath {
			t.Errorf("rule %q SourcePath = %q, want %q", c.rule, row.SourcePath, c.sourcePath)
		}
		if row.Writable != c.writable {
			t.Errorf("rule %q Writable = %v, want %v", c.rule, row.Writable, c.writable)
		}
	}
}

func TestMovePermissionRuleRoundTrip(t *testing.T) {
	home, projectRoot := permissionsFixture(t)

	globalSettings := filepath.Join(home, ".claude", "settings.json")
	projectLocal := filepath.Join(projectRoot, ".claude", "settings.local.json")

	from := PermissionScope{Kind: ScopeGlobal}
	to := PermissionScope{Kind: ScopeProjectLocal, ProjectRoot: projectRoot}
	if err := MovePermissionRule(from, to, PermAllow, PermAsk, "Bash(ls:*)"); err != nil {
		t.Fatalf("MovePermissionRule: %v", err)
	}

	if containsStr(readPermissionList(t, globalSettings, PermAllow), "Bash(ls:*)") {
		t.Errorf("rule still present in global allow after move")
	}
	if !containsStr(readPermissionList(t, projectLocal, PermAsk), "Bash(ls:*)") {
		t.Errorf("rule missing from project-local ask after move")
	}
}

// TestAddPermissionRuleCrashBetweenInvariant simulates a crash after the
// add-to-target step of a move but before remove-from-source: the rule must
// still be present in at least one file (never lost).
func TestAddPermissionRuleCrashBetweenInvariant(t *testing.T) {
	home, projectRoot := permissionsFixture(t)

	globalSettings := filepath.Join(home, ".claude", "settings.json")
	projectLocal := filepath.Join(projectRoot, ".claude", "settings.local.json")

	// Only the add half runs (target write); the remove never happens.
	to := PermissionScope{Kind: ScopeProjectLocal, ProjectRoot: projectRoot}
	if err := AddPermissionRule(to, PermAsk, "Bash(ls:*)"); err != nil {
		t.Fatalf("AddPermissionRule: %v", err)
	}

	inTarget := containsStr(readPermissionList(t, projectLocal, PermAsk), "Bash(ls:*)")
	inSource := containsStr(readPermissionList(t, globalSettings, PermAllow), "Bash(ls:*)")
	if !inTarget {
		t.Errorf("rule not present in target after add")
	}
	if !inSource {
		t.Errorf("rule vanished from source before remove ran")
	}
}

func TestAddPermissionRuleGlobalPreservesUnknownKeys(t *testing.T) {
	home, _ := permissionsFixture(t)
	globalSettings := filepath.Join(home, ".claude", "settings.json")

	// Seed an unrelated top-level key alongside permissions.defaultMode.
	writeSettingsFile(t, filepath.Dir(globalSettings), globalSettings, `{
		"theme": "dark",
		"permissions": {"defaultMode": "acceptEdits", "allow": ["Bash(ls:*)"]}
	}`)

	if err := AddPermissionRule(PermissionScope{Kind: ScopeGlobal}, PermDeny, "Bash(rm:*)"); err != nil {
		t.Fatalf("AddPermissionRule: %v", err)
	}

	raw, err := os.ReadFile(globalSettings)
	if err != nil {
		t.Fatalf("read settings.json: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("parse settings.json: %v", err)
	}
	if got["theme"] != "dark" {
		t.Errorf("theme not preserved: %v", got["theme"])
	}
	perms, _ := got["permissions"].(map[string]any)
	if perms["defaultMode"] != "acceptEdits" {
		t.Errorf("permissions.defaultMode not preserved: %v", perms["defaultMode"])
	}
	if !containsStr(readPermissionList(t, globalSettings, PermDeny), "Bash(rm:*)") {
		t.Errorf("added deny rule missing")
	}
	if !containsStr(readPermissionList(t, globalSettings, PermAllow), "Bash(ls:*)") {
		t.Errorf("existing allow rule dropped")
	}
}

func TestAddPermissionRuleProjectLocalPreservesKeysAndUsesOwnBak(t *testing.T) {
	_, projectRoot := permissionsFixture(t)
	projectLocal := filepath.Join(projectRoot, ".claude", "settings.local.json")

	// Seed the project-local file with an unrelated key + an env secret.
	writeSettingsFile(t, filepath.Dir(projectLocal), projectLocal, `{
		"customFlag": true,
		"env": {"SECRET": "shh"},
		"permissions": {"ask": ["Bash(git:*)"]}
	}`)
	seed, _ := os.ReadFile(projectLocal)

	if err := AddPermissionRule(
		PermissionScope{Kind: ScopeProjectLocal, ProjectRoot: projectRoot},
		PermAllow, "Read(src/*)",
	); err != nil {
		t.Fatalf("AddPermissionRule: %v", err)
	}

	var got map[string]any
	raw, _ := os.ReadFile(projectLocal)
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("parse settings.local.json: %v", err)
	}
	if got["customFlag"] != true {
		t.Errorf("customFlag not preserved: %v", got["customFlag"])
	}
	env, _ := got["env"].(map[string]any)
	if env["SECRET"] != "shh" {
		t.Errorf("env.SECRET not preserved: %v", env)
	}
	if !containsStr(readPermissionList(t, projectLocal, PermAllow), "Read(src/*)") {
		t.Errorf("added allow rule missing")
	}

	// project-local must use its OWN .bak holding the pre-mutation bytes.
	bak, err := os.ReadFile(projectLocal + ".bak")
	if err != nil {
		t.Fatalf("settings.local.json.bak not written: %v", err)
	}
	if string(bak) != string(seed) {
		t.Errorf("project-local .bak does not hold pre-mutation content")
	}
}

func TestAddPermissionRuleFirstEverGrantCreatesLocalSettings(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	projectRoot := t.TempDir() // no .claude dir at all

	projectLocal := filepath.Join(projectRoot, ".claude", "settings.local.json")
	if _, err := os.Stat(projectLocal); !os.IsNotExist(err) {
		t.Fatalf("precondition: settings.local.json should not exist yet")
	}

	if err := AddPermissionRule(
		PermissionScope{Kind: ScopeProjectLocal, ProjectRoot: projectRoot},
		PermDeny, "Bash(curl:*)",
	); err != nil {
		t.Fatalf("AddPermissionRule (first-ever grant): %v", err)
	}

	if !containsStr(readPermissionList(t, projectLocal, PermDeny), "Bash(curl:*)") {
		t.Errorf("first-ever grant did not create settings.local.json with the rule")
	}
	// No pre-existing file → no .bak.
	if _, err := os.Stat(projectLocal + ".bak"); !os.IsNotExist(err) {
		t.Errorf("expected no .bak for first-ever grant, stat err = %v", err)
	}
}

func TestAddPermissionRuleInvalidListRejectedBeforeWrite(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	settingsFile := filepath.Join(home, ".claude", "settings.json")

	err := AddPermissionRule(PermissionScope{Kind: ScopeGlobal}, "bogus", "Bash(ls:*)")
	if err == nil {
		t.Fatal("expected error for invalid list, got nil")
	}
	if _, statErr := os.Stat(settingsFile); !os.IsNotExist(statErr) {
		t.Errorf("settings.json should not have been written, stat err = %v", statErr)
	}
}

func TestAddPermissionRuleDisplayOnlyKindRejectedBeforeWrite(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	projectRoot := t.TempDir()
	projectLocal := filepath.Join(projectRoot, ".claude", "settings.local.json")

	// KindProject is display-only and must never reach the writer.
	err := AddPermissionRule(
		PermissionScope{Kind: KindProject, ProjectRoot: projectRoot},
		PermAllow, "Read(*)",
	)
	if err == nil {
		t.Fatal("expected error for display-only scope kind, got nil")
	}
	if _, statErr := os.Stat(projectLocal); !os.IsNotExist(statErr) {
		t.Errorf("settings.local.json should not have been written, stat err = %v", statErr)
	}
}
