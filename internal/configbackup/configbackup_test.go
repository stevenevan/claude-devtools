package configbackup

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setupRoot points HOME at a fresh temp dir and returns root = HOME/.claude and
// a separate appDataDir. root == claudeDir() so files.ReplaceSettingsJSON (which
// is HOME-based) restores settings.json to root/settings.json, keeping capture
// and restore consistent.
func setupRoot(t *testing.T) (root, appDataDir string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	root = filepath.Join(home, ".claude")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("mkdir root: %v", err)
	}
	return root, t.TempDir()
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func assertFileContent(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(got) != want {
		t.Errorf("%s = %q, want %q", path, string(got), want)
	}
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

func TestCaptureRestoreRoundTrip(t *testing.T) {
	root, appDataDir := setupRoot(t)
	writeFile(t, filepath.Join(root, "settings.json"), `{"theme":"dark","env":{"FOO":"bar"}}`)
	writeFile(t, filepath.Join(root, "CLAUDE.md"), "# Global\noriginal claude md\n")
	writeFile(t, filepath.Join(root, "rules", "style.md"), "rule content\n")
	writeFile(t, filepath.Join(root, "agents", "helper.md"), "---\nname: helper\n---\nbody\n")

	m, err := CaptureConfig(root, appDataDir, "snap1", false)
	if err != nil {
		t.Fatalf("CaptureConfig: %v", err)
	}
	if len(m.Files) == 0 {
		t.Fatal("no files captured")
	}

	writeFile(t, filepath.Join(root, "CLAUDE.md"), "# MUTATED\n")
	writeFile(t, filepath.Join(root, "rules", "style.md"), "MUTATED rule\n")
	writeFile(t, filepath.Join(root, "settings.json"), `{"theme":"light"}`)

	if err := RestoreConfig(root, appDataDir, m.ID, nil); err != nil {
		t.Fatalf("RestoreConfig: %v", err)
	}

	assertFileContent(t, filepath.Join(root, "CLAUDE.md"), "# Global\noriginal claude md\n")
	assertFileContent(t, filepath.Join(root, "rules", "style.md"), "rule content\n")
	assertFileContent(t, filepath.Join(root, "agents", "helper.md"), "---\nname: helper\n---\nbody\n")

	settings := readJSONMap(t, filepath.Join(root, "settings.json"))
	if settings["theme"] != "dark" {
		t.Errorf("settings.json not restored: %v", settings)
	}
	if _, err := os.Stat(filepath.Join(root, "settings.json.bak")); err != nil {
		t.Errorf("settings.json.bak missing after restore: %v", err)
	}
}

func TestExportRedactsSecretsEverywhere(t *testing.T) {
	root, appDataDir := setupRoot(t)
	const secret = "sk-verysecretcredential1234567890"
	writeFile(t, filepath.Join(root, "settings.json"), `{"env":{"API_KEY":"`+secret+`"},"theme":"dark"}`)
	writeFile(t, filepath.Join(root, "CLAUDE.md"), "token here: "+secret+"\nmore text\n")
	writeFile(t, filepath.Join(root, "agents", "a.md"), "agent uses "+secret+"\n")
	writeFile(t, filepath.Join(root, "projects", "-Users-x-proj", "memory", "fact.md"), "remember "+secret+"\n")

	m, err := CaptureConfig(root, appDataDir, "secret-snap", false)
	if err != nil {
		t.Fatalf("CaptureConfig: %v", err)
	}

	// Default export: whole-archive grep finds ZERO occurrences of the secret.
	dest := filepath.Join(t.TempDir(), "default.zip")
	if err := ExportBackup(appDataDir, m.ID, dest, false); err != nil {
		t.Fatalf("ExportBackup default: %v", err)
	}
	for name, content := range readArchive(t, dest) {
		if strings.Contains(content, secret) {
			t.Errorf("default export leaked secret in %q", name)
		}
	}
	if man := archiveManifest(t, dest); man.SecretsIncluded {
		t.Error("default export flagged SecretsIncluded=true")
	}

	// Opt-in export: verbatim, flagged.
	dest2 := filepath.Join(t.TempDir(), "optin.zip")
	if err := ExportBackup(appDataDir, m.ID, dest2, true); err != nil {
		t.Fatalf("ExportBackup opt-in: %v", err)
	}
	man2 := archiveManifest(t, dest2)
	if !man2.SecretsIncluded {
		t.Error("opt-in export not flagged SecretsIncluded=true")
	}
	foundVerbatim := false
	for _, content := range readArchive(t, dest2) {
		if strings.Contains(content, secret) {
			foundVerbatim = true
		}
	}
	if !foundVerbatim {
		t.Error("opt-in export did not carry the secret verbatim")
	}
}

func TestApplyImportStripsHooksFromSettings(t *testing.T) {
	root, appDataDir := setupRoot(t)
	writeFile(t, filepath.Join(root, "settings.json"), `{"theme":"dark"}`)

	importedSettings := `{
		"theme": "light",
		"hooks": {
			"PreToolUse": [
				{"matcher":"Bash","hooks":[{"type":"command","command":"echo IMPORTED_HOOK"}]}
			]
		}
	}`
	archive := makeArchive(t, map[string]string{"settings.json": importedSettings}, true)

	if err := ApplyImport(root, appDataDir, archive, []string{"settings"}); err != nil {
		t.Fatalf("ApplyImport: %v", err)
	}

	settings := readJSONMap(t, filepath.Join(root, "settings.json"))
	if _, ok := settings["hooks"]; ok {
		t.Error("settings.json still has a hooks key after import (ACE hole)")
	}
	if settings["theme"] != "light" {
		t.Errorf("settings.json theme not applied: %v", settings["theme"])
	}

	disabled := readJSONMap(t, filepath.Join(appDataDir, "hooks-disabled.json"))
	pre, ok := disabled["PreToolUse"].([]any)
	if !ok || len(pre) == 0 {
		t.Fatalf("imported hook not routed to hooks-disabled.json: %v", disabled)
	}
	cmd := pre[0].(map[string]any)["hooks"].([]any)[0].(map[string]any)["command"]
	if cmd != "echo IMPORTED_HOOK" {
		t.Errorf("disabled hook command = %v, want echo IMPORTED_HOOK", cmd)
	}
}

func TestValidateImportRejectsMaliciousEntries(t *testing.T) {
	cases := []struct{ name, entry string }{
		{"parent traversal", "../../evil"},
		{"absolute", "/etc/evil"},
		{"nested parent", "agents/../../x"},
		{"non-allowlisted", "projects/x/evil.jsonl"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// ValidateImport takes only an archive path — it structurally cannot
			// write to any config/app-data tree (zero disk writes).
			archive := makeRawArchive(t, map[string]string{tc.entry: "payload"})
			if _, err := ValidateImport(archive); err == nil {
				t.Errorf("expected rejection for entry %q", tc.entry)
			}
		})
	}
}

func TestValidateImportRejectsZipBomb(t *testing.T) {
	tooMany := map[string]string{}
	for i := 0; i < maxImportEntries+1; i++ {
		tooMany[fmt.Sprintf("rules/f%d.md", i)] = "x"
	}
	if _, err := ValidateImport(makeRawArchive(t, tooMany)); err == nil {
		t.Error("expected rejection for too many entries")
	}

	oversized := map[string]string{"rules/big.md": strings.Repeat("A", maxEntryBytes+10)}
	if _, err := ValidateImport(makeRawArchive(t, oversized)); err == nil {
		t.Error("expected rejection for an oversized entry")
	}
}

func TestApplyImportCreatesPreImportSnapshotAndUndoReverts(t *testing.T) {
	root, appDataDir := setupRoot(t)
	writeFile(t, filepath.Join(root, "settings.json"), `{"theme":"dark"}`)
	writeFile(t, filepath.Join(root, "CLAUDE.md"), "ORIGINAL\n")
	writeFile(t, filepath.Join(appDataDir, "hooks-disabled.json"),
		`{"PreToolUse":[{"matcher":"X","hooks":[{"type":"command","command":"echo pre"}]}]}`)

	imported := `{"theme":"light","hooks":{"SessionStart":[{"matcher":"*","hooks":[{"type":"command","command":"echo NEW"}]}]}}`
	archive := makeArchive(t, map[string]string{
		"settings.json": imported,
		"CLAUDE.md":     "IMPORTED CLAUDE\n",
	}, true)

	if err := ApplyImport(root, appDataDir, archive, []string{"settings", "instructions"}); err != nil {
		t.Fatalf("ApplyImport: %v", err)
	}

	// Pre-import snapshot exists.
	backups, err := ListConfigBackups(appDataDir)
	if err != nil {
		t.Fatalf("ListConfigBackups: %v", err)
	}
	preImportID := ""
	for _, b := range backups {
		if b.Label == "pre-import" {
			preImportID = b.ID
		}
	}
	if preImportID == "" {
		t.Fatal("no pre-import snapshot created")
	}

	// Import applied.
	if readJSONMap(t, filepath.Join(root, "settings.json"))["theme"] != "light" {
		t.Error("import did not apply settings")
	}
	assertFileContent(t, filepath.Join(root, "CLAUDE.md"), "IMPORTED CLAUDE\n")
	disabled := readJSONMap(t, filepath.Join(appDataDir, "hooks-disabled.json"))
	if arr, _ := disabled["SessionStart"].([]any); len(arr) == 0 {
		t.Error("imported hook not disabled")
	}

	// One-click undo restores everything (incl. hooks-disabled.json).
	if err := RestoreConfig(root, appDataDir, preImportID, nil); err != nil {
		t.Fatalf("RestoreConfig undo: %v", err)
	}
	if readJSONMap(t, filepath.Join(root, "settings.json"))["theme"] != "dark" {
		t.Error("undo did not revert settings.json")
	}
	assertFileContent(t, filepath.Join(root, "CLAUDE.md"), "ORIGINAL\n")
	reverted := readJSONMap(t, filepath.Join(appDataDir, "hooks-disabled.json"))
	if _, ok := reverted["SessionStart"]; ok {
		t.Error("undo did not remove the appended disabled group")
	}
	if _, ok := reverted["PreToolUse"]; !ok {
		t.Error("undo lost the original disabled group")
	}
}

// ─── archive test helpers ───────────────────────────────────────────────────

// makeArchive builds a valid import archive (files + a schema-valid manifest).
func makeArchive(t *testing.T, entries map[string]string, secretsIncluded bool) string {
	t.Helper()
	man := Manifest{
		ID:              "test-backup-id",
		Label:           "imported",
		CreatedMs:       1,
		SecretsIncluded: secretsIncluded,
		Files:           []FileEntry{},
		SkillLinks:      []SkillLink{},
	}
	for name, content := range entries {
		sum := sha256.Sum256([]byte(content))
		man.Files = append(man.Files, FileEntry{
			RelPath: filepath.FromSlash(name),
			Size:    int64(len(content)),
			SHA256:  hex.EncodeToString(sum[:]),
		})
	}
	manBytes, err := json.MarshalIndent(man, "", "  ")
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	full := map[string]string{}
	for k, v := range entries {
		full[k] = v
	}
	full["manifest.json"] = string(manBytes)
	return makeRawArchive(t, full)
}

// makeRawArchive zips entries verbatim (no manifest synthesis) — used for the
// malicious-entry / zip-bomb cases that must be rejected before any manifest
// check.
func makeRawArchive(t *testing.T, entries map[string]string) string {
	t.Helper()
	dest := filepath.Join(t.TempDir(), "archive.zip")
	f, err := os.Create(dest)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for name, content := range entries {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
		if err != nil {
			t.Fatalf("create zip entry %q: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry %q: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	return dest
}

func readArchive(t *testing.T, path string) map[string]string {
	t.Helper()
	zr, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	defer zr.Close()
	out := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open entry %q: %v", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read entry %q: %v", f.Name, err)
		}
		out[f.Name] = string(data)
	}
	return out
}

func archiveManifest(t *testing.T, path string) Manifest {
	t.Helper()
	raw, ok := readArchive(t, path)["manifest.json"]
	if !ok {
		t.Fatal("archive has no manifest.json")
	}
	var m Manifest
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("parse archive manifest: %v", err)
	}
	return m
}
