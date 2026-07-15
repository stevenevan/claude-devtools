package files

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// SettingsPatch is the frontend-editable subset of ~/.claude/settings.json.
type SettingsPatch struct {
	Env   map[string]string `json:"env"`
	Allow []string          `json:"allow"`
	Deny  []string          `json:"deny"`
	Ask   []string          `json:"ask"`
}

var settingsWriteMu sync.Mutex

// envKeyPattern matches valid POSIX environment variable names.
var envKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// MutateSettingsJSON is the SINGLE writer of ~/.claude/settings.json — every
// config editor (weeks 16-28) routes its write through this one mutex. It locks
// settingsWriteMu, reads the file fresh (never trusts a frontend snapshot, so
// it's safe against the CLI rewriting concurrently), and calls mutate on the
// parsed map. CONTRACT: settings.json.bak is written from the pre-mutation bytes
// BEFORE mutate runs — a caller needing a no-.bak-on-invalid-input guarantee
// must validate BEFORE calling (as UpdateGlobalSettings does with env keys). A
// corrupt current file returns an error and mutate never runs (use
// ReplaceSettingsJSON to overwrite a corrupt current file). Write is
// MarshalIndent → temp+rename.
func MutateSettingsJSON(mutate func(m map[string]any) error) error {
	settingsWriteMu.Lock()
	defer settingsWriteMu.Unlock()

	cd, err := claudeDir()
	if err != nil {
		return err
	}
	settingsFile := filepath.Join(cd, "settings.json")

	raw, err := os.ReadFile(settingsFile)
	fileExists := err == nil
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("files: read settings.json: %w", err)
	}

	m := map[string]any{}
	if fileExists {
		if err := json.Unmarshal(raw, &m); err != nil {
			return fmt.Errorf("files: parse settings.json: %w", err)
		}
		if err := os.WriteFile(settingsFile+".bak", raw, 0o644); err != nil {
			return fmt.Errorf("files: write settings.json.bak: %w", err)
		}
	}

	if err := mutate(m); err != nil {
		return err
	}

	if err := os.MkdirAll(cd, 0o755); err != nil {
		return fmt.Errorf("files: mkdir .claude: %w", err)
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("files: marshal settings.json: %w", err)
	}
	return atomicWriteSettings(settingsFile, data)
}

// ReplaceSettingsJSON overwrites settings.json with newRaw (validated JSON),
// backing up the CURRENT bytes to .bak AS-IS first (even if the current file is
// corrupt — so a bad state stays recoverable). Shares settingsWriteMu with
// MutateSettingsJSON. Used by restore, where MutateSettingsJSON's
// parse-the-current-file gate would otherwise block fixing a corrupt current.
func ReplaceSettingsJSON(newRaw []byte) error {
	var probe map[string]any
	if err := json.Unmarshal(newRaw, &probe); err != nil {
		return fmt.Errorf("files: refusing to write invalid settings JSON: %w", err)
	}

	settingsWriteMu.Lock()
	defer settingsWriteMu.Unlock()

	cd, err := claudeDir()
	if err != nil {
		return err
	}
	settingsFile := filepath.Join(cd, "settings.json")

	if cur, err := os.ReadFile(settingsFile); err == nil {
		if err := os.WriteFile(settingsFile+".bak", cur, 0o644); err != nil {
			return fmt.Errorf("files: write settings.json.bak: %w", err)
		}
	}
	if err := os.MkdirAll(cd, 0o755); err != nil {
		return fmt.Errorf("files: mkdir .claude: %w", err)
	}
	return atomicWriteSettings(settingsFile, newRaw)
}

func atomicWriteSettings(settingsFile string, data []byte) error {
	tmpPath := settingsFile + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return fmt.Errorf("files: write settings.json.tmp: %w", err)
	}
	if err := os.Rename(tmpPath, settingsFile); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("files: rename settings.json.tmp: %w", err)
	}
	return nil
}

// UpdateGlobalSettings replaces only "env" and "permissions.{allow,deny,ask}",
// preserving every other key. Env-key validation stays BEFORE the mutator so an
// invalid key never writes .bak (behavior identical to the pre-extraction code).
func UpdateGlobalSettings(patch SettingsPatch) error {
	for k := range patch.Env {
		if !envKeyPattern.MatchString(k) {
			return fmt.Errorf("files: invalid env key %q: must match %s", k, envKeyPattern.String())
		}
	}
	return MutateSettingsJSON(func(m map[string]any) error {
		env := patch.Env
		if env == nil {
			env = map[string]string{}
		}
		m["env"] = env

		perms, ok := m["permissions"].(map[string]any)
		if !ok {
			perms = map[string]any{}
		}
		perms["allow"] = nonNilStrings(patch.Allow)
		perms["deny"] = nonNilStrings(patch.Deny)
		perms["ask"] = nonNilStrings(patch.Ask)
		m["permissions"] = perms
		return nil
	})
}

// nonNilStrings keeps a nil slice from marshaling as JSON null.
func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
