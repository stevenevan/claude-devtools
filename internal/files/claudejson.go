// claudejson.go is the read-only X-ray of ~/.claude.json — the CLI's most
// critical state file. It holds real account/token material, so EVERY value
// that leaves this package is masked key-OR-value (the same contract as the
// settings.json masking): the census carries key name + value kind + size
// ONLY, never a raw value; per-value display goes through the explicit
// RevealClaudeJSONValue, which itself re-applies masking so secret-matched
// paths never surface raw token material. Values are NEVER logged.
package files

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"claude-devtools/internal/discovery"
)

// claudeJSONMask is the placeholder rendered in place of any secret-shaped
// key or value. Matches redactSecrets.ts's client-side mask so the two layers
// look identical.
const claudeJSONMask = "••••"

// claudeJSONRetryDelay is the single short pause before the one retry read.
// The CLI rewrites ~/.claude.json via temp+rename constantly; a read landing
// mid-rename sees a vanishing/partial file, so we retry once rather than
// declaring the file "corrupt".
const claudeJSONRetryDelay = 40 * time.Millisecond

// secretKeyPattern is the Go port of envSecretMatcher.ts's SECRET_KEY_PATTERN,
// extended with the claude.json-specific credential blobs (OAUTH already
// catches oauthAccount; EMAIL/ACCOUNT catch the account/email material). Fails
// open: an unmatched key stays plaintext, so the pattern is deliberately broad.
var secretKeyPattern = regexp.MustCompile(
	`(?i)PASSWORD|PASSWD|SECRET|CREDENTIAL|PRIVATE_KEY|PASSPHRASE|TOKEN|_KEY$|_PAT$|AUTH|API_KEY|API.?KEY|ACCESS.?KEY|SECRET.?KEY|PRIVATE.?KEY|OAUTH|BEARER|EMAIL|ACCOUNT`,
)

// secretValuePattern is the Go port of redactSecrets.ts's SECRET_VALUE_PATTERN:
// value shapes that look like secrets regardless of key name.
var secretValuePattern = regexp.MustCompile(
	`^(sk-|ghp_|gho_|github_pat_|AKIA|xox[baprs]-|eyJ[A-Za-z0-9_-]+\.|Bearer )`,
)

// claudeJSONBackupRe matches the CLI's own rolling backup filenames
// (e.g. ".claude.json.backup.1783695046813"). Read validation requires this
// shape so ReadClaudeJSONBackup can never be turned into an arbitrary-file read.
var claudeJSONBackupRe = regexp.MustCompile(`^[A-Za-z0-9._-]*\.claude\.json\.backup\.[A-Za-z0-9_-]+$`)

// ClaudeJSONKey is one top-level (or flag) key in the census: its name, value
// kind, approximate serialized size, and whether it is credential-shaped. It
// deliberately carries NO raw value.
type ClaudeJSONKey struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Bytes  int    `json:"bytes"`
	Secret bool   `json:"secret"`
}

// ClaudeJSONProject is one entry in the projects table: its path (the map key),
// approximate size, key count, and stale triage. Never carries the entry value.
type ClaudeJSONProject struct {
	Path     string `json:"path"`
	Bytes    int    `json:"bytes"`
	KeyCount int    `json:"keyCount"`
	Triage   string `json:"triage"` // "live" | "stale" | "unverifiable"
}

// ClaudeJSONCensus is the full read-only X-ray of ~/.claude.json.
type ClaudeJSONCensus struct {
	Path     string              `json:"path"`
	Bytes    int                 `json:"bytes"`
	TopLevel []ClaudeJSONKey     `json:"topLevel"`
	Flags    []ClaudeJSONKey     `json:"flags"`
	Projects []ClaudeJSONProject `json:"projects"`
}

// ClaudeJSONBackup is one enumerated CLI backup file.
type ClaudeJSONBackup struct {
	Name    string    `json:"name"`
	Bytes   int64     `json:"bytes"`
	ModTime time.Time `json:"modTime"`
}

// Triage states for project entries.
const (
	triageLive         = "live"
	triageStale        = "stale"
	triageUnverifiable = "unverifiable"
)

// claudeJSONPath returns ~/.claude.json (home-based, like the CLI writes it).
func claudeJSONPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("files: cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".claude.json"), nil
}

// claudeJSONBackupsDir returns ~/.claude/backups.
func claudeJSONBackupsDir() (string, error) {
	cd, err := claudeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cd, "backups"), nil
}

// readClaudeJSONWithRetry reads path and, on any read or JSON-validity failure,
// retries exactly once after a short delay before giving up with a "try again"
// error — never "corrupt" or "repair" (the failure is a mid-rewrite race, not
// damage). Returns the raw bytes on success.
func readClaudeJSONWithRetry(path string) ([]byte, error) {
	if data, err := os.ReadFile(path); err == nil && json.Valid(data) {
		return data, nil
	}
	time.Sleep(claudeJSONRetryDelay)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("files: could not read ~/.claude.json (the CLI may be rewriting it) — try again: %w", err)
	}
	if !json.Valid(data) {
		return nil, fmt.Errorf("files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again")
	}
	return data, nil
}

// isSecretKey reports whether a key name is credential-shaped.
func isSecretKey(key string) bool {
	return secretKeyPattern.MatchString(key)
}

// isSecretStringValue reports whether a value is a string matching a known
// token shape (checked without ever emitting or logging the value itself).
func isSecretStringValue(value any) bool {
	s, ok := value.(string)
	return ok && secretValuePattern.MatchString(s)
}

// maskJSONValue returns value with every secret-shaped key or value replaced by
// the mask placeholder, recursing into objects (masking children by their own
// key) and arrays (by value shape). Mirrors redactSecrets.ts's
// redactSecretValues exactly. Pure — never mutates its input.
func maskJSONValue(key string, value any) any {
	if isSecretKey(key) || isSecretStringValue(value) {
		return claudeJSONMask
	}
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, child := range v {
			out[k] = maskJSONValue(k, child)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, child := range v {
			out[i] = maskJSONValue("", child)
		}
		return out
	default:
		return value
	}
}

// jsonKind names value's JSON type for the census (no value emitted).
func jsonKind(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case float64, json.Number:
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return "unknown"
	}
}

// approxSize is the byte length of value re-serialized as JSON — a size signal
// only; the serialized bytes are discarded, never returned.
func approxSize(v any) int {
	b, err := json.Marshal(v)
	if err != nil {
		return 0
	}
	return len(b)
}

// isFlagKey reports whether name is one of the one-off hasSeen*/cached* flags
// grouped separately in the census.
func isFlagKey(name string) bool {
	return strings.HasPrefix(name, "hasSeen") || strings.HasPrefix(name, "cached")
}

// ReadClaudeJSON returns the read-only census of ~/.claude.json: top-level keys
// (name/kind/size), grouped hasSeen*/cached* flags, and the project-entry table
// with stale triage. Carries no raw values.
func ReadClaudeJSON() (ClaudeJSONCensus, error) {
	path, err := claudeJSONPath()
	if err != nil {
		return ClaudeJSONCensus{}, err
	}
	data, err := readClaudeJSONWithRetry(path)
	if err != nil {
		return ClaudeJSONCensus{}, err
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		return ClaudeJSONCensus{}, fmt.Errorf("files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again")
	}

	census := ClaudeJSONCensus{Path: path, Bytes: len(data)}
	for name, v := range root {
		if name == "projects" {
			census.Projects = buildProjectTriage(v)
			continue
		}
		key := ClaudeJSONKey{
			Name:   name,
			Kind:   jsonKind(v),
			Bytes:  approxSize(v),
			Secret: isSecretKey(name) || isSecretStringValue(v),
		}
		if isFlagKey(name) {
			census.Flags = append(census.Flags, key)
		} else {
			census.TopLevel = append(census.TopLevel, key)
		}
	}

	sortKeys(census.TopLevel)
	sortKeys(census.Flags)
	sort.Slice(census.Projects, func(i, j int) bool { return census.Projects[i].Path < census.Projects[j].Path })
	if census.TopLevel == nil {
		census.TopLevel = []ClaudeJSONKey{}
	}
	if census.Flags == nil {
		census.Flags = []ClaudeJSONKey{}
	}
	if census.Projects == nil {
		census.Projects = []ClaudeJSONProject{}
	}
	return census, nil
}

func sortKeys(keys []ClaudeJSONKey) {
	sort.Slice(keys, func(i, j int) bool { return keys[i].Name < keys[j].Name })
}

// buildProjectTriage builds the projects table with per-entry stale triage.
func buildProjectTriage(v any) []ClaudeJSONProject {
	pm, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	liveSet := liveProjectPaths()
	out := make([]ClaudeJSONProject, 0, len(pm))
	for path, entry := range pm {
		keyCount := 0
		if em, ok := entry.(map[string]any); ok {
			keyCount = len(em)
		}
		out = append(out, ClaudeJSONProject{
			Path:     path,
			Bytes:    approxSize(entry),
			KeyCount: keyCount,
			Triage:   triageProject(path, liveSet),
		})
	}
	return out
}

// liveProjectPaths lists ~/.claude/projects and decodes each encoded dir name
// to its (lossy) original path. Lightweight — NOT discovery.ScanProjects, which
// clears the shared registry and scans JSONL. A missing/unreadable dir yields
// an empty set.
func liveProjectPaths() map[string]bool {
	set := map[string]bool{}
	dir, err := discovery.ProjectsDir()
	if err != nil {
		return set
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return set
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if decoded := discovery.DecodePath(e.Name()); decoded != "" {
			set[decoded] = true
		}
	}
	return set
}

// triageProject classifies a claude.json project path as live/stale/
// unverifiable. os.Stat on the real path is authoritative when it succeeds. A
// path that is gone from disk is only ever "stale" when it is UNAMBIGUOUS: a
// hyphen in any path segment makes the encoded-dir cross-reference lossy (the
// decoder trap that fooled the audit), so such a path is "unverifiable" — never
// a guessed deletion candidate.
func triageProject(path string, liveSet map[string]bool) string {
	info, err := os.Stat(path)
	if err == nil {
		_ = info
		return triageLive
	}
	if !os.IsNotExist(err) {
		return triageUnverifiable // permission or other stat error — cannot determine
	}
	if pathHasHyphenSegment(path) {
		return triageUnverifiable
	}
	if liveSet[path] {
		return triageLive // an unambiguous projects/ dir still references it
	}
	return triageStale
}

// pathHasHyphenSegment reports whether any '/'-delimited segment of p contains a
// hyphen — the exact condition under which Claude Code's dir encoding is lossy.
func pathHasHyphenSegment(p string) bool {
	for _, seg := range strings.Split(p, "/") {
		if strings.Contains(seg, "-") {
			return true
		}
	}
	return false
}

// RevealClaudeJSONValue returns the masked JSON of a single top-level key's
// value for explicit per-value display. Non-secret values render in full;
// credential-shaped keys/values come back masked — this call never surfaces raw
// token material and never logs the value.
func RevealClaudeJSONValue(keyPath string) (string, error) {
	path, err := claudeJSONPath()
	if err != nil {
		return "", err
	}
	data, err := readClaudeJSONWithRetry(path)
	if err != nil {
		return "", err
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		return "", fmt.Errorf("files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again")
	}
	v, ok := root[keyPath]
	if !ok {
		return "", fmt.Errorf("files: key %q not found in ~/.claude.json", keyPath)
	}
	b, err := json.MarshalIndent(maskJSONValue(keyPath, v), "", "  ")
	if err != nil {
		return "", fmt.Errorf("files: marshal revealed value: %w", err)
	}
	return string(b), nil
}

// ReadClaudeJSONMasked returns the full live ~/.claude.json server-side-masked,
// so the inspector can diff live-vs-backup masked-vs-masked without any raw
// value ever crossing to the renderer. Same masking contract as the census and
// backup reads; values never logged.
func ReadClaudeJSONMasked() (string, error) {
	path, err := claudeJSONPath()
	if err != nil {
		return "", err
	}
	data, err := readClaudeJSONWithRetry(path)
	if err != nil {
		return "", err
	}
	var root any
	if err := json.Unmarshal(data, &root); err != nil {
		return "", fmt.Errorf("files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again")
	}
	b, err := json.MarshalIndent(maskJSONValue("", root), "", "  ")
	if err != nil {
		return "", fmt.Errorf("files: marshal masked ~/.claude.json: %w", err)
	}
	return string(b), nil
}

// ListClaudeJSONBackups enumerates ~/.claude/backups/*.claude.json.backup.*
// newest-first. A missing backups dir is not an error (yields an empty list).
func ListClaudeJSONBackups() ([]ClaudeJSONBackup, error) {
	dir, err := claudeJSONBackupsDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ClaudeJSONBackup{}, nil
		}
		return nil, fmt.Errorf("files: read backups dir: %w", err)
	}
	out := []ClaudeJSONBackup{}
	for _, e := range entries {
		if e.IsDir() || !strings.Contains(e.Name(), ".claude.json.backup.") {
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

// validateBackupName rejects anything that isn't a bare backup filename,
// mirroring ReadPlanFile's guard (no separators, no ".", no ".." ) plus the
// backup-shape match — so this endpoint is never an arbitrary-file-read.
func validateBackupName(name string) error {
	if name == "" || strings.ContainsRune(name, '/') || strings.ContainsRune(name, filepath.Separator) ||
		name == "." || name == ".." || strings.Contains(name, "..") {
		return fmt.Errorf("files: invalid backup file name")
	}
	if !claudeJSONBackupRe.MatchString(name) {
		return fmt.Errorf("files: invalid backup file name")
	}
	return nil
}

// ReadClaudeJSONBackup returns a single backup's server-side-masked JSON so the
// diff is masked-vs-masked and raw secrets never cross to the renderer. name is
// validated + Confine-checked within the canonical backups dir.
func ReadClaudeJSONBackup(name string) (string, error) {
	if err := validateBackupName(name); err != nil {
		return "", err
	}
	dir, err := claudeJSONBackupsDir()
	if err != nil {
		return "", err
	}
	canonDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", fmt.Errorf("files: backups dir: %w", err)
	}
	confined, err := Confine(filepath.Join(canonDir, name), canonDir)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(confined)
	if err != nil {
		return "", fmt.Errorf("files: read backup: %w", err)
	}
	var root any
	if err := json.Unmarshal(data, &root); err != nil {
		return "", fmt.Errorf("files: backup %q is not readable right now — try again", name)
	}
	b, err := json.MarshalIndent(maskJSONValue("", root), "", "  ")
	if err != nil {
		return "", fmt.Errorf("files: marshal backup: %w", err)
	}
	return string(b), nil
}
