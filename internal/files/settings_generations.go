package files

import (
	"fmt"
	"os"
	"path/filepath"
)

// settingsGenerations is the FIXED allowlist of settings.json generations the
// diff/restore panel may read — never an arbitrary path.
var settingsGenerations = []string{
	"settings.json",
	"settings.json.bak",
	"settings.json.pre-ponytail",
}

func isSettingsGeneration(name string) bool {
	for _, g := range settingsGenerations {
		if g == name {
			return true
		}
	}
	return false
}

// ListSettingsGenerations returns the allowlisted generations that exist on disk.
func ListSettingsGenerations() ([]string, error) {
	cd, err := claudeDir()
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, g := range settingsGenerations {
		if info, err := os.Lstat(filepath.Join(cd, g)); err == nil && !info.IsDir() {
			out = append(out, g)
		}
	}
	return out, nil
}

// ReadSettingsGeneration returns an allowlisted generation's raw JSON text (or
// "" if absent). Refuses any name outside the allowlist.
func ReadSettingsGeneration(name string) (string, error) {
	if !isSettingsGeneration(name) {
		return "", fmt.Errorf("files: %q is not a settings generation", name)
	}
	cd, err := claudeDir()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(cd, name))
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// RestoreSettingsGeneration overwrites settings.json with the chosen generation
// through ReplaceSettingsJSON (current → .bak as-is, new parse-validated, atomic).
func RestoreSettingsGeneration(name string) error {
	if !isSettingsGeneration(name) {
		return fmt.Errorf("files: %q is not a settings generation", name)
	}
	if name == "settings.json" {
		return fmt.Errorf("files: cannot restore settings.json onto itself")
	}
	cd, err := claudeDir()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(cd, name))
	if err != nil {
		return fmt.Errorf("files: read generation %q: %w", name, err)
	}
	return ReplaceSettingsJSON(data)
}
