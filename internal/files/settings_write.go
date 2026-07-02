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

// UpdateGlobalSettings read-modify-writes ~/.claude/settings.json: only
// "env" and "permissions.{allow,deny,ask}" are replaced, every other
// top-level and nested-permissions key is preserved. The mutex plus
// reading the file fresh on every call (instead of trusting a snapshot the
// frontend held onto) keeps this safe against the CLI rewriting
// settings.json concurrently (e.g. /theme, plugin installs).
func UpdateGlobalSettings(patch SettingsPatch) error {
	settingsWriteMu.Lock()
	defer settingsWriteMu.Unlock()

	for k := range patch.Env {
		if !envKeyPattern.MatchString(k) {
			return fmt.Errorf("files: invalid env key %q: must match %s", k, envKeyPattern.String())
		}
	}

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
		if err := os.WriteFile(filepath.Join(cd, "settings.json.bak"), raw, 0o644); err != nil {
			return fmt.Errorf("files: write settings.json.bak: %w", err)
		}
	}

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

	if err := os.MkdirAll(cd, 0o755); err != nil {
		return fmt.Errorf("files: mkdir .claude: %w", err)
	}

	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("files: marshal settings.json: %w", err)
	}

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

// nonNilStrings keeps a nil slice from marshaling as JSON null.
func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
