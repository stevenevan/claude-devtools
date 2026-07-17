package paritytest

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"claude-devtools/internal/configbackup"
)

// The fixture archive + golden are shared with the Rust cargo test
// (src-tauri/src/configbackup/import_tests.rs::apply_import_matches_go_golden),
// which applies the SAME committed archive and asserts the SAME post-import
// bytes. Proves "import of a fixture archive yields identical on-disk result
// incl. disarmed hooks" across Go and Rust — the W14 gate.
const (
	configbackupFixturePath = "testdata/configbackup_fixture.zip"
	configbackupGoldenPath  = "testdata/configbackup_import.golden.json"
)

// fixtureSettings has a hook group (must move to hooks-disabled.json on import),
// a "••••" placeholder (must be dropped), and a permission rule (must survive).
const fixtureSettings = `{
  "permissions": { "allow": ["Bash(echo hi && ls)"] },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "echo pre > /tmp/x" } ] }
    ]
  },
  "apiKey": "••••",
  "model": "claude-opus-4-8"
}`

func buildFixtureArchive(t *testing.T, path string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	write := func(name, content string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	manifest := configbackup.Manifest{
		ID:              "fixture",
		Label:           "fixture",
		SecretsIncluded: false,
	}
	mb, _ := json.MarshalIndent(manifest, "", "  ")
	write("manifest.json", string(mb))
	write("settings.json", fixtureSettings)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
}

type configbackupGolden struct {
	Settings      string `json:"settings"`
	HooksDisabled string `json:"hooksDisabled"`
}

// applyFixture applies the fixture archive to a fresh temp home+appData and
// returns the resulting settings.json + hooks-disabled.json bytes. CRITICAL:
// ApplyImport writes settings.json via files.ReplaceSettingsJSON, which anchors
// to claudeDir() = $HOME/.claude (NOT the root arg). So $HOME MUST be redirected
// to a temp dir — else this clobbers the real ~/.claude/settings.json.
func applyFixture(t *testing.T, archivePath string) configbackupGolden {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	root := filepath.Join(home, ".claude")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	appData := t.TempDir()
	if err := configbackup.ApplyImport(root, appData, archivePath, []string{"settings"}); err != nil {
		t.Fatalf("ApplyImport: %v", err)
	}
	settings, err := os.ReadFile(filepath.Join(root, "settings.json"))
	if err != nil {
		t.Fatalf("read settings.json: %v", err)
	}
	hooks, err := os.ReadFile(filepath.Join(appData, "hooks-disabled.json"))
	if err != nil {
		t.Fatalf("read hooks-disabled.json: %v", err)
	}
	return configbackupGolden{Settings: string(settings), HooksDisabled: string(hooks)}
}

func TestConfigbackupImportGolden(t *testing.T) {
	fixture := filepath.Clean(configbackupFixturePath)
	golden := filepath.Clean(configbackupGoldenPath)

	if os.Getenv("GEN_GOLDENS") == "1" {
		buildFixtureArchive(t, fixture)
		result := applyFixture(t, fixture)
		gb, _ := json.MarshalIndent(result, "", "  ")
		if err := os.WriteFile(golden, append(gb, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s + %s", fixture, golden)
		return
	}

	result := applyFixture(t, fixture)
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatalf("read golden (run with GEN_GOLDENS=1 to create): %v", err)
	}
	gb, _ := json.MarshalIndent(result, "", "  ")
	if string(gb)+"\n" != string(want) {
		t.Errorf("configbackup import golden mismatch; regenerate with GEN_GOLDENS=1\n got: %s", gb)
	}
}
