package config

import (
	"fmt"
	"os"
	"path/filepath"
)

const appDataDirEnv = "CLAUDE_DEVTOOLS_DIR"

// AppDataDir returns the claude-devtools app-data root: $CLAUDE_DEVTOOLS_DIR
// (must be set and absolute) if present, else $HOME/.claude-devtools.
// This is the single resolver for the app-data tree — callers must not
// re-derive it via os.UserHomeDir().
func AppDataDir() (string, error) {
	if override := os.Getenv(appDataDirEnv); override != "" {
		if !filepath.IsAbs(override) {
			return "", fmt.Errorf("%s must be an absolute path, got %q", appDataDirEnv, override)
		}
		return override, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory")
	}
	return filepath.Join(home, ".claude-devtools"), nil
}
