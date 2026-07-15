package files

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// writeClaudeJSONPretty writes a 2-space pretty-printed ~/.claude.json (matching
// how the CLI stores it) at 0o600 and returns the exact bytes written.
func writeClaudeJSONPretty(t *testing.T, home string, content map[string]any) []byte {
	t.Helper()
	data, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), data, 0o600); err != nil {
		t.Fatalf("write .claude.json: %v", err)
	}
	return data
}

// bigClaudeJSONFixture builds a real-shaped ~/.claude.json: 90+ top-level keys
// including oauthAccount (credential-shaped), a large-integer field (to prove
// the json.RawMessage path preserves number bytes losslessly), and a projects
// map holding several stale-shaped entries plus a live and an unverifiable one.
func bigClaudeJSONFixture(home, liveOnDisk string) map[string]any {
	m := map[string]any{
		"numStartups": 2543,
		"theme":       "dark",
		"helper":      fixtureToken, // benign key name, secret-shaped value
		"bigIntField": json.Number("123456789012345678901234567890"),
		"oauthAccount": map[string]any{
			"emailAddress": fixtureEmail,
			"accountUuid":  "uuid-1234",
			"accessToken":  "sk-secret-access",
		},
		"hasSeenTasksHint": true,
		"cachedChangelog":  "v1.2.3 notes",
		"projects": map[string]any{
			liveOnDisk:              map[string]any{"allowedTools": []any{"Bash"}, "hasTrustDialogAccepted": true},
			"/zzz_stale_one":        map[string]any{"allowedTools": []any{}, "history": []any{"a", "b"}},
			"/zzz_stale_two":        map[string]any{"allowedTools": []any{"Read"}},
			"/zzz_stale_three":      map[string]any{"lastCost": 1.25},
			"/zzz-unverifiable-dir": map[string]any{"history": []any{}},
		},
	}
	for i := 0; i < 90; i++ {
		m[fmt.Sprintf("pad_%02d", i)] = fmt.Sprintf("value-%d", i)
	}
	return m
}

func TestPurgeClaudeJSONRemovesStaleAndPreservesValues(t *testing.T) {
	home := claudeJSONHome(t)
	liveOnDisk := filepath.Join(home, "liveworkdir")
	if err := os.MkdirAll(liveOnDisk, 0o755); err != nil {
		t.Fatalf("mkdir live: %v", err)
	}
	pre := writeClaudeJSONPretty(t, home, bigClaudeJSONFixture(home, liveOnDisk))

	var preTop map[string]json.RawMessage
	if err := json.Unmarshal(pre, &preTop); err != nil {
		t.Fatalf("decode pre: %v", err)
	}

	staleKeys := []string{"/zzz_stale_one", "/zzz_stale_two", "/zzz_stale_three"}
	res, err := PurgeClaudeJSONProjects(staleKeys)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if len(res.RemovedKeys) != 3 {
		t.Errorf("removedKeys = %v, want 3", res.RemovedKeys)
	}
	if res.BytesAfter >= res.BytesBefore {
		t.Errorf("expected file to shrink, before=%d after=%d", res.BytesBefore, res.BytesAfter)
	}

	out, err := os.ReadFile(filepath.Join(home, ".claude.json"))
	if err != nil {
		t.Fatalf("read out: %v", err)
	}
	if !json.Valid(out) {
		t.Fatal("output is not valid JSON")
	}
	if !bytes.Contains(out, []byte("\n  \"")) {
		t.Error("output is not 2-space pretty-printed")
	}

	var outTop map[string]json.RawMessage
	if err := json.Unmarshal(out, &outTop); err != nil {
		t.Fatalf("decode out: %v", err)
	}

	// Every non-projects top-level value must be content-identical to the pre-image.
	for k, preVal := range preTop {
		if k == "projects" {
			continue
		}
		outVal, ok := outTop[k]
		if !ok {
			t.Errorf("top-level key %q dropped", k)
			continue
		}
		if !compactRawEqual(preVal, outVal) {
			t.Errorf("top-level value %q changed: pre=%s out=%s", k, preVal, outVal)
		}
	}

	// The large integer survived losslessly (proves the json.RawMessage path).
	if !bytes.Contains(out, []byte("123456789012345678901234567890")) {
		t.Error("big integer field was not preserved losslessly")
	}
	// oauthAccount material preserved verbatim by the write.
	if !bytes.Contains(out, []byte(fixtureEmail)) {
		t.Error("oauthAccount email not preserved")
	}

	var outPM map[string]json.RawMessage
	if err := json.Unmarshal(outTop["projects"], &outPM); err != nil {
		t.Fatalf("decode out projects: %v", err)
	}
	for _, k := range staleKeys {
		if _, ok := outPM[k]; ok {
			t.Errorf("purged key %q still present", k)
		}
	}
	for _, k := range []string{liveOnDisk, "/zzz-unverifiable-dir"} {
		if _, ok := outPM[k]; !ok {
			t.Errorf("non-purged project %q was removed", k)
		}
	}
}

func TestPurgeClaudeJSONRejectsNonProjectKey(t *testing.T) {
	home := claudeJSONHome(t)
	liveOnDisk := filepath.Join(home, "liveworkdir")
	if err := os.MkdirAll(liveOnDisk, 0o755); err != nil {
		t.Fatalf("mkdir live: %v", err)
	}
	pre := writeClaudeJSONPretty(t, home, bigClaudeJSONFixture(home, liveOnDisk))

	// A credential-shaped top-level key and a benign top-level key are both
	// rejected — the purge can only ever target project entries.
	for _, k := range []string{"oauthAccount", "numStartups", "bigIntField"} {
		if _, err := PurgeClaudeJSONProjects([]string{k}); err == nil {
			t.Errorf("purge(%q) should be rejected", k)
		}
	}
	after, _ := os.ReadFile(filepath.Join(home, ".claude.json"))
	if !bytes.Equal(pre, after) {
		t.Error("file mutated after a rejected purge")
	}
	backups, _ := ListClaudeJSONAppBackups()
	if len(backups) != 0 {
		t.Errorf("rejected purge created %d app backups, want 0", len(backups))
	}
}

func TestPurgeClaudeJSONCorruptUntouched(t *testing.T) {
	home := claudeJSONHome(t)
	corrupt := []byte("{ not valid json")
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), corrupt, 0o600); err != nil {
		t.Fatalf("write corrupt: %v", err)
	}
	if _, err := PurgeClaudeJSONProjects([]string{"/whatever"}); err == nil {
		t.Fatal("purge of a corrupt file should error")
	}
	after, _ := os.ReadFile(filepath.Join(home, ".claude.json"))
	if !bytes.Equal(corrupt, after) {
		t.Error("corrupt file was modified")
	}
	backups, _ := ListClaudeJSONAppBackups()
	if len(backups) != 0 {
		t.Errorf("corrupt purge created %d backups, want 0", len(backups))
	}
}

func TestPurgeClaudeJSONRejectsLiveOrUnverifiable(t *testing.T) {
	home := claudeJSONHome(t)
	liveOnDisk := filepath.Join(home, "liveworkdir")
	if err := os.MkdirAll(liveOnDisk, 0o755); err != nil {
		t.Fatalf("mkdir live: %v", err)
	}
	pre := writeClaudeJSONPretty(t, home, bigClaudeJSONFixture(home, liveOnDisk))

	for _, k := range []string{liveOnDisk, "/zzz-unverifiable-dir"} {
		if _, err := PurgeClaudeJSONProjects([]string{k}); err == nil {
			t.Errorf("purge(%q) should be rejected (not stale)", k)
		}
	}
	// A mixed request (one stale + one live) rejects the WHOLE purge — no partial.
	if _, err := PurgeClaudeJSONProjects([]string{"/zzz_stale_one", liveOnDisk}); err == nil {
		t.Error("mixed stale+live purge should be rejected wholesale")
	}
	after, _ := os.ReadFile(filepath.Join(home, ".claude.json"))
	if !bytes.Equal(pre, after) {
		t.Error("file mutated after a rejected purge")
	}
	backups, _ := ListClaudeJSONAppBackups()
	if len(backups) != 0 {
		t.Errorf("rejected purge created %d backups, want 0", len(backups))
	}
}

func TestClaudeJSONAppBackupAndRestore(t *testing.T) {
	home := claudeJSONHome(t)
	liveOnDisk := filepath.Join(home, "liveworkdir")
	if err := os.MkdirAll(liveOnDisk, 0o755); err != nil {
		t.Fatalf("mkdir live: %v", err)
	}
	pre := writeClaudeJSONPretty(t, home, bigClaudeJSONFixture(home, liveOnDisk))

	res, err := PurgeClaudeJSONProjects([]string{"/zzz_stale_one"})
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if res.BackupName == "" {
		t.Fatal("purge did not report a backup name")
	}

	dir, err := claudeJSONAppBackupsDir()
	if err != nil {
		t.Fatalf("app backups dir: %v", err)
	}
	dInfo, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("stat backups dir: %v", err)
	}
	if dInfo.Mode().Perm() != 0o700 {
		t.Errorf("backups dir mode = %o, want 700", dInfo.Mode().Perm())
	}

	bPath := filepath.Join(dir, res.BackupName)
	bInfo, err := os.Stat(bPath)
	if err != nil {
		t.Fatalf("stat backup: %v", err)
	}
	if bInfo.Mode().Perm() != 0o600 {
		t.Errorf("backup file mode = %o, want 600", bInfo.Mode().Perm())
	}
	bData, _ := os.ReadFile(bPath)
	if !bytes.Equal(bData, pre) {
		t.Error("app backup is not the exact pre-purge bytes")
	}

	backups, err := ListClaudeJSONAppBackups()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	found := false
	for _, b := range backups {
		if b.Name == res.BackupName {
			found = true
		}
	}
	if !found {
		t.Error("purge backup not listed by ListClaudeJSONAppBackups")
	}

	// Full-file restore reproduces the pre-purge file exactly (auth included).
	if err := RestoreClaudeJSONAppBackup(res.BackupName); err != nil {
		t.Fatalf("restore: %v", err)
	}
	restored, _ := os.ReadFile(filepath.Join(home, ".claude.json"))
	if !bytes.Equal(restored, pre) {
		t.Error("restore did not reproduce the pre-purge file exactly")
	}
}

// TestPurgeClaudeJSONCASRaceSurfacesConflict drives the full purge path while an
// injected hook simulates the CLI rewriting the file inside the read→rename
// window on every attempt. The compare-and-swap must detect it, do exactly one
// retry, then surface a conflict — never renaming our stale map over the CLI's
// fresh write and never leaving a half-purged file.
func TestPurgeClaudeJSONCASRaceSurfacesConflict(t *testing.T) {
	home := claudeJSONHome(t)
	liveOnDisk := filepath.Join(home, "liveworkdir")
	if err := os.MkdirAll(liveOnDisk, 0o755); err != nil {
		t.Fatalf("mkdir live: %v", err)
	}
	writeClaudeJSONPretty(t, home, bigClaudeJSONFixture(home, liveOnDisk))
	jsonPath := filepath.Join(home, ".claude.json")

	// Each injected write differs (raceCounter) but keeps the targeted stale key,
	// so every attempt passes triage yet fails the CAS re-read.
	inject := func(n int) []byte {
		c := bigClaudeJSONFixture(home, liveOnDisk)
		c["raceCounter"] = n
		b, err := json.MarshalIndent(c, "", "  ")
		if err != nil {
			t.Fatalf("marshal inject: %v", err)
		}
		return b
	}
	counter := 0
	claudeJSONWriteRaceHook = func() {
		counter++
		if err := os.WriteFile(jsonPath, inject(counter), 0o600); err != nil {
			t.Fatalf("hook write: %v", err)
		}
	}
	defer func() { claudeJSONWriteRaceHook = nil }()

	_, err := PurgeClaudeJSONProjects([]string{"/zzz_stale_one"})
	if err == nil {
		t.Fatal("expected a conflict error; purge may have clobbered a racing write")
	}
	if !errors.Is(err, errClaudeJSONConflict) {
		t.Errorf("expected errClaudeJSONConflict, got %v", err)
	}
	if counter != 2 {
		t.Errorf("hook fired %d times, want 2 (initial attempt + one retry)", counter)
	}

	final, _ := os.ReadFile(jsonPath)
	if !bytes.Equal(final, inject(2)) {
		t.Error("purge clobbered the external write instead of surfacing a conflict")
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(final, &top); err != nil {
		t.Fatalf("decode final: %v", err)
	}
	var pm map[string]json.RawMessage
	if err := json.Unmarshal(top["projects"], &pm); err != nil {
		t.Fatalf("decode final projects: %v", err)
	}
	if _, ok := pm["/zzz_stale_one"]; !ok {
		t.Error("stale key was purged from the external write (half-purge)")
	}
}

func TestRestoreClaudeJSONAppBackupRejectsBadNames(t *testing.T) {
	claudeJSONHome(t)
	bad := []string{
		"",
		".",
		"..",
		"../../../etc/passwd.claude.json.bak",
		"foo/bar.claude.json.bak",
		"..1234.claude.json.bak",
		"1234.claude.json.bak/..",
		"notabackup.txt",
	}
	for _, name := range bad {
		t.Run(name, func(t *testing.T) {
			if err := RestoreClaudeJSONAppBackup(name); err == nil {
				t.Errorf("restore(%q) should be rejected", name)
			}
		})
	}
}
