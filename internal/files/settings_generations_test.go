package files

import (
	"os"
	"testing"
)

func TestRestoreSettingsGenerationRoundTrip(t *testing.T) {
	dir, settingsFile, bakFile, _ := settingsPaths(t)
	current := `{"theme":"dark","model":"opus"}`
	generation := `{"theme":"light"}`
	writeSettingsFile(t, dir, settingsFile, current)
	writeSettingsFile(t, dir, settingsFile+".pre-ponytail", generation)

	if err := RestoreSettingsGeneration("settings.json.pre-ponytail"); err != nil {
		t.Fatal(err)
	}

	got, _ := os.ReadFile(settingsFile)
	if string(got) != generation {
		t.Errorf("settings.json should now hold the generation, got %s", got)
	}
	bak, _ := os.ReadFile(bakFile)
	if string(bak) != current {
		t.Errorf(".bak should hold the pre-restore content, got %s", bak)
	}
}

// A corrupt CURRENT settings.json is exactly what restore exists to fix; it must
// succeed and preserve the corrupt bytes in .bak (Metis res 1 / ReplaceSettingsJSON).
func TestRestoreOverCorruptCurrent(t *testing.T) {
	dir, settingsFile, bakFile, _ := settingsPaths(t)
	corrupt := `{not valid json`
	generation := `{"theme":"light"}`
	writeSettingsFile(t, dir, settingsFile, corrupt)
	writeSettingsFile(t, dir, settingsFile+".bak", generation) // restore from .bak

	if err := RestoreSettingsGeneration("settings.json.bak"); err != nil {
		t.Fatalf("restore must fix a corrupt current file: %v", err)
	}
	got, _ := os.ReadFile(settingsFile)
	if string(got) != generation {
		t.Errorf("settings.json should be the valid generation, got %s", got)
	}
	bak, _ := os.ReadFile(bakFile)
	if string(bak) != corrupt {
		t.Errorf(".bak should preserve the corrupt bytes for recovery, got %s", bak)
	}
}

func TestRestoreCorruptGenerationRefused(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	current := `{"theme":"dark"}`
	writeSettingsFile(t, dir, settingsFile, current)
	writeSettingsFile(t, dir, settingsFile+".pre-ponytail", `{bad`)

	if err := RestoreSettingsGeneration("settings.json.pre-ponytail"); err == nil {
		t.Error("restoring a corrupt generation must error")
	}
	got, _ := os.ReadFile(settingsFile)
	if string(got) != current {
		t.Error("settings.json must be untouched when the generation is corrupt")
	}
}

func TestSettingsGenerationAllowlist(t *testing.T) {
	settingsPaths(t)
	if _, err := ReadSettingsGeneration("../../etc/passwd"); err == nil {
		t.Error("non-allowlisted name must be refused")
	}
	if err := RestoreSettingsGeneration("settings.json"); err == nil {
		t.Error("restoring settings.json onto itself must be refused")
	}
}
