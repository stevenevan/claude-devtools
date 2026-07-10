package files

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

const testSecretValue = "sk-ant-secret123"

// sourcesFixture builds: $HOME/.claude/settings.json (global, holds a real
// secret value), $HOME/.claude/.claude/settings.local.json (nested anomaly),
// and a temp projectRoot with .claude/settings.json (project, overrides
// "theme") + .claude/settings.local.json (project-local).
func sourcesFixture(t *testing.T) (home, projectRoot string) {
	t.Helper()
	home = t.TempDir()
	t.Setenv("HOME", home)
	projectRoot = t.TempDir()

	globalDir := filepath.Join(home, ".claude")
	writeSettingsFile(t, globalDir, filepath.Join(globalDir, "settings.json"), `{
		"theme": "dark",
		"env": {"ANTHROPIC_API_KEY": "`+testSecretValue+`"},
		"permissions": {"defaultMode": "acceptEdits"}
	}`)

	nestedDir := filepath.Join(globalDir, ".claude")
	writeSettingsFile(t, nestedDir, filepath.Join(nestedDir, "settings.local.json"), `{
		"permissions": {"allow": ["Bash(rm:*)"]}
	}`)

	projectDir := filepath.Join(projectRoot, ".claude")
	writeSettingsFile(t, projectDir, filepath.Join(projectDir, "settings.json"), `{"theme": "light"}`)
	writeSettingsFile(t, projectDir, filepath.Join(projectDir, "settings.local.json"), `{"customFlag": true}`)

	return home, projectRoot
}

func findSource(sources []Source, kind string) (Source, bool) {
	for _, s := range sources {
		if s.Kind == kind {
			return s, true
		}
	}
	return Source{}, false
}

func TestEnumerateSettingsSourcesAllFourSurfaced(t *testing.T) {
	_, projectRoot := sourcesFixture(t)

	view, err := EnumerateSettingsSources(projectRoot)
	if err != nil {
		t.Fatalf("EnumerateSettingsSources: %v", err)
	}
	if len(view.Sources) != 4 {
		t.Fatalf("len(Sources) = %d, want 4: %+v", len(view.Sources), view.Sources)
	}

	global, ok := findSource(view.Sources, KindGlobal)
	if !ok || !global.Exists || global.IsAnomaly {
		t.Errorf("global source wrong: %+v", global)
	}

	nested, ok := findSource(view.Sources, KindGlobalNestedAnomaly)
	if !ok || !nested.Exists || !nested.IsAnomaly {
		t.Errorf("nested anomaly source wrong: %+v", nested)
	}

	project, ok := findSource(view.Sources, KindProject)
	if !ok || !project.Exists || project.IsAnomaly {
		t.Errorf("project source wrong: %+v", project)
	}

	projectLocal, ok := findSource(view.Sources, KindProjectLocal)
	if !ok || !projectLocal.Exists || projectLocal.IsAnomaly {
		t.Errorf("project-local source wrong: %+v", projectLocal)
	}
}

func TestEnumerateSettingsSourcesMissingProjectSourcesReportExistsFalse(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	globalDir := filepath.Join(home, ".claude")
	writeSettingsFile(t, globalDir, filepath.Join(globalDir, "settings.json"), `{"theme": "dark"}`)

	projectRoot := t.TempDir() // no .claude/ dir at all

	view, err := EnumerateSettingsSources(projectRoot)
	if err != nil {
		t.Fatalf("EnumerateSettingsSources: %v", err)
	}
	if len(view.Sources) != 3 {
		t.Fatalf("len(Sources) = %d, want 3 (global + project + project-local; no anomaly dir, project sources absent but still listed)", len(view.Sources))
	}
	project, ok := findSource(view.Sources, KindProject)
	if !ok || project.Exists {
		t.Errorf("project source should report Exists=false: %+v", project)
	}
}

func TestEnumerateSettingsSourcesMergedProvenance(t *testing.T) {
	_, projectRoot := sourcesFixture(t)

	view, err := EnumerateSettingsSources(projectRoot)
	if err != nil {
		t.Fatalf("EnumerateSettingsSources: %v", err)
	}

	if view.Merged["theme"] != "light" {
		t.Errorf("Merged[theme] = %v, want light (project should win over global)", view.Merged["theme"])
	}
	projectSettingsPath := filepath.Join(projectRoot, ".claude", "settings.json")
	if view.Provenance["theme"] != projectSettingsPath {
		t.Errorf("Provenance[theme] = %q, want %q", view.Provenance["theme"], projectSettingsPath)
	}

	globalSettingsPath := filepath.Join(os.Getenv("HOME"), ".claude", "settings.json")
	if _, ok := view.Merged["env"]; !ok {
		t.Errorf("Merged[env] missing (global-only key should survive the merge)")
	}
	if view.Provenance["env"] != globalSettingsPath {
		t.Errorf("Provenance[env] = %q, want %q", view.Provenance["env"], globalSettingsPath)
	}

	if view.Merged["customFlag"] != true {
		t.Errorf("Merged[customFlag] = %v, want true (project-local key should survive the merge)", view.Merged["customFlag"])
	}

	// The nested anomaly's key must never leak into Merged/Provenance.
	if view.Provenance["permissions"] != globalSettingsPath {
		t.Errorf("Provenance[permissions] = %q, want global path %q (nested anomaly must not win)", view.Provenance["permissions"], globalSettingsPath)
	}
}

// TestEnumerateSettingsSourcesNeverLogsSecrets is the SEC L2 log-leak test:
// a source's Raw holds a real-looking secret value. It must never reach a
// logger, across both the normal path and a parse-error path (a malformed
// project-local file, which mergeSources must skip without erroring).
func TestEnumerateSettingsSourcesNeverLogsSecrets(t *testing.T) {
	_, projectRoot := sourcesFixture(t)

	var buf bytes.Buffer
	prevLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(prevLogger)

	if _, err := EnumerateSettingsSources(projectRoot); err != nil {
		t.Fatalf("EnumerateSettingsSources (normal path): %v", err)
	}

	// Corrupt project-local to force the mergeSources parse-error path.
	projectLocalPath := filepath.Join(projectRoot, ".claude", "settings.local.json")
	if err := os.WriteFile(projectLocalPath, []byte("{not valid json"), 0o644); err != nil {
		t.Fatalf("corrupt project-local settings: %v", err)
	}
	view, err := EnumerateSettingsSources(projectRoot)
	if err != nil {
		t.Fatalf("EnumerateSettingsSources (parse-error path): %v", err)
	}
	if _, ok := view.Merged["customFlag"]; ok {
		t.Errorf("Merged[customFlag] should be absent once project-local is unparseable")
	}

	if bytes.Contains(buf.Bytes(), []byte(testSecretValue)) {
		t.Fatalf("secret value leaked into logs: %s", buf.String())
	}
}
