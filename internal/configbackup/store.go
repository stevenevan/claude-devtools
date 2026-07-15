package configbackup

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// manifestPath returns backupDir/manifest.json.
func manifestPath(backupDir string) string {
	return filepath.Join(backupDir, "manifest.json")
}

// writeManifest writes manifest.json atomically (temp+rename), mode 0600 (it
// lists user config paths).
func writeManifest(backupDir string, m Manifest) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("configbackup: marshal manifest: %w", err)
	}
	path := manifestPath(backupDir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("configbackup: write manifest: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("configbackup: rename manifest: %w", err)
	}
	return nil
}

// readManifest reads and parses backupDir/manifest.json.
func readManifest(backupDir string) (Manifest, error) {
	data, err := os.ReadFile(manifestPath(backupDir))
	if err != nil {
		return Manifest{}, fmt.Errorf("configbackup: read manifest: %w", err)
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Manifest{}, fmt.Errorf("configbackup: parse manifest: %w", err)
	}
	return m, nil
}

// ListConfigBackups enumerates every backup's manifest under
// <appDataDir>/config-backups, newest first. A missing store is not an error.
func ListConfigBackups(appDataDir string) ([]Manifest, error) {
	base := configBackupsDir(appDataDir)
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return []Manifest{}, nil
		}
		return nil, fmt.Errorf("configbackup: read backup store: %w", err)
	}
	out := []Manifest{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m, err := readManifest(filepath.Join(base, e.Name()))
		if err != nil {
			continue // no/corrupt manifest — skip, not fatal
		}
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedMs > out[j].CreatedMs })
	return out, nil
}

// DeleteConfigBackup removes one backup's whole dir tree. The store is
// app-owned (never user data), so os.RemoveAll is the correct primitive here —
// same rationale as internal/maintenance's trash removal (grep-gate 6a
// allowlists internal/configbackup).
func DeleteConfigBackup(appDataDir, id string) error {
	if err := validateBackupID(id); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(configBackupsDir(appDataDir), id))
}
