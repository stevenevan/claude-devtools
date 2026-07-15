// claudejson_write.go is the guarded write half of the ~/.claude.json X-ray:
// the ONLY code in the app that mutates the CLI's most critical state file.
// Every write is defended in depth — a dedicated mutex, server-side re-triage
// (never trusting the client), a value-preserving surgical delete that touches
// only provably-stale project entries, a structural deny-list that aborts
// before any disk I/O if a credential-shaped key would change, a full unmasked
// app-side backup, a compare-and-swap immediately before the rename to catch a
// racing CLI write, and a post-write re-verify. Auth/credential material is
// never mutated, never downgraded to a weaker file mode, never clobbered.
package files

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"claude-devtools/internal/config"
)

// claudeJSONWriteMu serializes every ~/.claude.json write. Dedicated on purpose
// — it must NEVER be settingsWriteMu; the two files are independent and a write
// to one must never block on the other.
var claudeJSONWriteMu sync.Mutex

// errClaudeJSONConflict signals that the CLI rewrote ~/.claude.json inside our
// read→rename window. It is the ONE retryable failure (one retry from a fresh
// read); a second conflict is surfaced, never looped.
var errClaudeJSONConflict = errors.New("files: ~/.claude.json changed on disk during the purge (the CLI wrote concurrently) — no changes were made; please refresh and try again")

// claudeJSONWriteRaceHook, when non-nil, runs once inside a purge attempt right
// after the fresh read and before the compare-and-swap re-read. TEST-ONLY seam
// to simulate a concurrent CLI rewrite landing in the read→rename window; it is
// nil in production.
var claudeJSONWriteRaceHook func()

// PurgeResult reports the outcome of a purge: which project keys were removed,
// the file size before/after, and the app-side backup filename created before
// the write.
type PurgeResult struct {
	RemovedKeys []string `json:"removedKeys"`
	BytesBefore int      `json:"bytesBefore"`
	BytesAfter  int      `json:"bytesAfter"`
	BackupName  string   `json:"backupName"`
}

// claudeJSONAppBackupsDir returns <AppDataDir>/claude-json-backups — the app's
// OWN pre-write backup store. Never ~/.claude/backups (the CLI owns that dir).
func claudeJSONAppBackupsDir() (string, error) {
	appDir, err := config.AppDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(appDir, "claude-json-backups"), nil
}

// atomicWriteClaudeJSON writes data to path via temp+rename, PRESERVING the
// file's existing permission mode (default 0o600 if the file is absent). It
// chmods the temp to that exact mode so the rename can never downgrade
// ~/.claude.json (normally 0o600) to world-readable. Do NOT use the 0o644
// atomicWriteFile/atomicWriteSettings for this file.
func atomicWriteClaudeJSON(path string, data []byte) error {
	mode := os.FileMode(0o600)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, mode); err != nil {
		return fmt.Errorf("files: write %s: %w", filepath.Base(tmpPath), err)
	}
	if err := os.Chmod(tmpPath, mode); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("files: chmod %s: %w", filepath.Base(tmpPath), err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("files: rename %s: %w", filepath.Base(tmpPath), err)
	}
	return nil
}

// writeClaudeJSONAppBackup copies data to <AppDataDir>/claude-json-backups as a
// timestamped .claude.json.bak, creating the dir at 0o700 and the file at 0o600
// (it is a full UNMASKED copy of the file's auth material). Returns the backup's
// bare filename.
func writeClaudeJSONAppBackup(data []byte) (string, error) {
	dir, err := claudeJSONAppBackupsDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("files: mkdir app backups dir: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return "", fmt.Errorf("files: chmod app backups dir: %w", err)
	}
	name := fmt.Sprintf("%d.claude.json.bak", time.Now().UnixNano())
	dst := filepath.Join(dir, name)
	if err := os.WriteFile(dst, data, 0o600); err != nil {
		return "", fmt.Errorf("files: write app backup: %w", err)
	}
	if err := os.Chmod(dst, 0o600); err != nil {
		return "", fmt.Errorf("files: chmod app backup: %w", err)
	}
	return name, nil
}

// compactRawEqual reports whether two JSON values are content-identical,
// ignoring insignificant whitespace. The purge re-marshals + re-indents the
// whole file, so raw value bytes may be re-spaced; content (and nested key
// order, which neither marshal nor json.Indent reorders) is what must not
// change — that is the property protecting auth material.
func compactRawEqual(a, b json.RawMessage) bool {
	var ba, bb bytes.Buffer
	if err := json.Compact(&ba, a); err != nil {
		return false
	}
	if err := json.Compact(&bb, b); err != nil {
		return false
	}
	return bytes.Equal(ba.Bytes(), bb.Bytes())
}

// PurgeClaudeJSONProjects removes the given project-entry keys from
// ~/.claude.json. Every key is re-triaged server-side and must be provably
// stale; a single live/unverifiable/absent/credential-shaped key rejects the
// WHOLE purge (no partial writes). Non-"projects" values — especially auth
// material — are proven content-identical before the file is touched. Holds
// claudeJSONWriteMu across a single CAS-guarded retry.
func PurgeClaudeJSONProjects(keys []string) (PurgeResult, error) {
	if len(keys) == 0 {
		return PurgeResult{}, fmt.Errorf("files: no project entries selected for purge")
	}

	claudeJSONWriteMu.Lock()
	defer claudeJSONWriteMu.Unlock()

	for attempt := 0; ; attempt++ {
		result, err := purgeClaudeJSONProjectsOnce(keys)
		if errors.Is(err, errClaudeJSONConflict) && attempt == 0 {
			continue // one retry from a fresh read
		}
		return result, err
	}
}

// purgeClaudeJSONProjectsOnce runs one full purge attempt. The caller holds
// claudeJSONWriteMu. It reads fresh, re-triages, deletes surgically, guards
// against any non-project mutation, backs up, CAS-checks, writes, and re-verifies.
func purgeClaudeJSONProjectsOnce(keys []string) (PurgeResult, error) {
	path, err := claudeJSONPath()
	if err != nil {
		return PurgeResult{}, err
	}

	// Step 1: read fresh; keep the raw pre-image. Corrupt/mid-rewrite → error,
	// don't touch the file.
	pre, err := readClaudeJSONWithRetry(path)
	if err != nil {
		return PurgeResult{}, err
	}

	if claudeJSONWriteRaceHook != nil {
		claudeJSONWriteRaceHook()
	}

	// Decode the pristine reference and a mutable working copy from the same
	// bytes. json.RawMessage keeps each value's raw bytes, so numbers/big-ints
	// survive losslessly (no float64 coercion).
	var preTop map[string]json.RawMessage
	if err := json.Unmarshal(pre, &preTop); err != nil {
		return PurgeResult{}, fmt.Errorf("files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again")
	}
	var topRaw map[string]json.RawMessage
	if err := json.Unmarshal(pre, &topRaw); err != nil {
		return PurgeResult{}, fmt.Errorf("files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again")
	}

	projectsMap := map[string]json.RawMessage{}
	if pv, ok := topRaw["projects"]; ok {
		if err := json.Unmarshal(pv, &projectsMap); err != nil {
			return PurgeResult{}, fmt.Errorf("files: ~/.claude.json projects block is not readable right now — try again")
		}
	}

	// Step 2: re-triage EVERY requested key server-side. Never trust the client.
	liveSet := liveProjectPaths()
	for _, k := range keys {
		if _, present := projectsMap[k]; !present {
			return PurgeResult{}, fmt.Errorf("files: refusing purge: %q is not a project entry in ~/.claude.json", k)
		}
		if triageProject(k, liveSet) != triageStale {
			return PurgeResult{}, fmt.Errorf("files: refusing purge: %q is not provably stale (live or unverifiable) — not purgeable", k)
		}
	}

	// Step 3: delete exactly the requested keys, re-marshal, restore 2-space
	// pretty-print.
	for _, k := range keys {
		delete(projectsMap, k)
	}
	newProjects, err := json.Marshal(projectsMap)
	if err != nil {
		return PurgeResult{}, fmt.Errorf("files: marshal projects: %w", err)
	}
	topRaw["projects"] = newProjects
	compact, err := json.Marshal(topRaw)
	if err != nil {
		return PurgeResult{}, fmt.Errorf("files: marshal ~/.claude.json: %w", err)
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, compact, "", "  "); err != nil {
		return PurgeResult{}, fmt.Errorf("files: indent ~/.claude.json: %w", err)
	}
	out := buf.Bytes()

	// Structural deny-list guard on the ACTUAL bytes we are about to write.
	if err := guardPurgeOutput(pre, out, preTop, keys); err != nil {
		return PurgeResult{}, err
	}

	// Step 4: app-side backup of the full unmasked pre-image BEFORE the rename.
	backupName, err := writeClaudeJSONAppBackup(pre)
	if err != nil {
		return PurgeResult{}, err
	}

	// Step 5: compare-and-swap immediately before the rename. A read error or
	// any difference means the CLI wrote during our window — abort (retryable),
	// never rename our now-stale map over the CLI's fresh write.
	if cur, err := os.ReadFile(path); err != nil || !bytes.Equal(cur, pre) {
		return PurgeResult{}, errClaudeJSONConflict
	}
	if err := atomicWriteClaudeJSON(path, out); err != nil {
		return PurgeResult{}, err
	}

	// Step 6: post-write re-verify — purged keys absent AND no credential key
	// mutated (covers a CLI rewrite landing after our rename). Surface, no loop.
	if err := verifyPurgeApplied(path, preTop, keys); err != nil {
		return PurgeResult{}, err
	}

	removed := append([]string(nil), keys...)
	return PurgeResult{
		RemovedKeys: removed,
		BytesBefore: len(pre),
		BytesAfter:  len(out),
		BackupName:  backupName,
	}, nil
}

// guardPurgeOutput proves that out differs from pre ONLY by the removal of the
// requested project keys: the top-level key set is unchanged, every non-project
// value is content-identical (auth material included), and within "projects"
// only the requested keys are absent while everything else is byte-preserved.
// Any deviation aborts before disk I/O.
func guardPurgeOutput(pre, out []byte, preTop map[string]json.RawMessage, keys []string) error {
	var outTop map[string]json.RawMessage
	if err := json.Unmarshal(out, &outTop); err != nil {
		return fmt.Errorf("files: purge produced unreadable JSON — aborting")
	}

	if len(outTop) != len(preTop) {
		return fmt.Errorf("files: purge would change the top-level key set — aborting")
	}
	for k, preVal := range preTop {
		outVal, ok := outTop[k]
		if !ok {
			return fmt.Errorf("files: purge would drop top-level key %q — aborting", k)
		}
		if k == "projects" {
			continue
		}
		if !compactRawEqual(preVal, outVal) {
			if isSecretKey(k) {
				return fmt.Errorf("files: purge would mutate credential key %q — aborting", k)
			}
			return fmt.Errorf("files: purge would mutate top-level key %q — aborting", k)
		}
	}

	var prePM, outPM map[string]json.RawMessage
	if err := json.Unmarshal(preTop["projects"], &prePM); err != nil {
		return fmt.Errorf("files: ~/.claude.json projects block unreadable — try again")
	}
	if err := json.Unmarshal(outTop["projects"], &outPM); err != nil {
		return fmt.Errorf("files: purge produced an unreadable projects block — aborting")
	}
	requested := make(map[string]bool, len(keys))
	for _, k := range keys {
		requested[k] = true
	}
	for k, preVal := range prePM {
		if requested[k] {
			if _, still := outPM[k]; still {
				return fmt.Errorf("files: purge failed to remove project %q — aborting", k)
			}
			continue
		}
		outVal, ok := outPM[k]
		if !ok || !compactRawEqual(preVal, outVal) {
			return fmt.Errorf("files: purge would alter unrelated project %q — aborting", k)
		}
	}
	if len(outPM) != len(prePM)-len(requested) {
		return fmt.Errorf("files: purge changed the project count unexpectedly — aborting")
	}
	return nil
}

// verifyPurgeApplied re-reads the live file after the write and confirms the
// purged keys are gone and no credential-shaped top-level key changed relative
// to the pre-image (catching a CLI rewrite that lands right after our rename).
func verifyPurgeApplied(path string, preTop map[string]json.RawMessage, keys []string) error {
	after, err := readClaudeJSONWithRetry(path)
	if err != nil {
		return fmt.Errorf("files: purge written but ~/.claude.json could not be re-verified — please refresh: %w", err)
	}
	var afterTop map[string]json.RawMessage
	if err := json.Unmarshal(after, &afterTop); err != nil {
		return fmt.Errorf("files: purge written but ~/.claude.json is not readable for verification — please refresh")
	}
	var afterPM map[string]json.RawMessage
	if pv, ok := afterTop["projects"]; ok {
		_ = json.Unmarshal(pv, &afterPM)
	}
	for _, k := range keys {
		if _, ok := afterPM[k]; ok {
			return fmt.Errorf("files: %q reappeared in ~/.claude.json after purge (the CLI rewrote it) — please refresh and retry", k)
		}
	}
	for k, preVal := range preTop {
		if k == "projects" || !isSecretKey(k) {
			continue
		}
		afterVal, ok := afterTop[k]
		if !ok || !compactRawEqual(preVal, afterVal) {
			return fmt.Errorf("files: credential key %q changed in ~/.claude.json right after purge (CLI activity) — please verify your auth and refresh", k)
		}
	}
	return nil
}

// ListClaudeJSONAppBackups enumerates <AppDataDir>/claude-json-backups/
// *.claude.json.bak newest-first. A missing dir yields an empty list, not an
// error.
func ListClaudeJSONAppBackups() ([]ClaudeJSONBackup, error) {
	dir, err := claudeJSONAppBackupsDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ClaudeJSONBackup{}, nil
		}
		return nil, fmt.Errorf("files: read app backups dir: %w", err)
	}
	out := []ClaudeJSONBackup{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".claude.json.bak") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, ClaudeJSONBackup{Name: e.Name(), Bytes: info.Size(), ModTime: info.ModTime()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out, nil
}

// validateClaudeJSONAppBackupName is a dedicated .bak-shape validator for the
// app's own backups. It is NOT validateBackupName (whose regex requires the
// CLI's ".claude.json.backup.<suffix>" shape and would reject our ".bak"
// names). Rejects empty, ".", "..", any ".." substring, and any path separator.
func validateClaudeJSONAppBackupName(name string) error {
	if name == "" || name == "." || name == ".." ||
		strings.ContainsRune(name, '/') || strings.ContainsRune(name, filepath.Separator) ||
		strings.Contains(name, "..") {
		return fmt.Errorf("files: invalid backup file name")
	}
	if !strings.HasSuffix(name, ".claude.json.bak") {
		return fmt.Errorf("files: invalid backup file name")
	}
	return nil
}

// RestoreClaudeJSONAppBackup replaces the live ~/.claude.json with the FULL
// contents of the named app-side backup (NOT the projects-only guard, which
// would reject a legitimate restore whose auth keys differ from the current
// file). The current file is backed up first. The caller/UI must warn that this
// reverts ALL state — including auth — to the backup point.
func RestoreClaudeJSONAppBackup(name string) error {
	if err := validateClaudeJSONAppBackupName(name); err != nil {
		return err
	}
	dir, err := claudeJSONAppBackupsDir()
	if err != nil {
		return err
	}
	canonDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return fmt.Errorf("files: app backups dir: %w", err)
	}
	confined, err := Confine(filepath.Join(canonDir, name), canonDir)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(confined)
	if err != nil {
		return fmt.Errorf("files: read backup: %w", err)
	}
	if !json.Valid(data) {
		return fmt.Errorf("files: backup %q is not valid JSON — refusing to restore", name)
	}

	claudeJSONWriteMu.Lock()
	defer claudeJSONWriteMu.Unlock()

	path, err := claudeJSONPath()
	if err != nil {
		return err
	}
	if cur, err := os.ReadFile(path); err == nil {
		if _, err := writeClaudeJSONAppBackup(cur); err != nil {
			return err
		}
	}
	return atomicWriteClaudeJSON(path, data)
}
