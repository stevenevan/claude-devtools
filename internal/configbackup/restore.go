package configbackup

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"claude-devtools/internal/files"
)

// RestoreConfig restores files from backup id back into root. With an empty
// relPaths it restores the whole profile (and the hooks-disabled.json snapshot,
// if the backup carries one — the one-click undo); otherwise only the named
// files. Every destination is validated against matchConfigAllowlist AND
// confined via confineImportDest, so a tampered manifest can never write outside
// the allowlist. settings.json routes through the sanctioned
// files.ReplaceSettingsJSON (.bak-first, atomic); every other file is written
// temp+rename with a .bak inside its confined parent. Never touches projects/,
// todos/, caches, or ~/.claude.json.
func RestoreConfig(root, appDataDir, id string, relPaths []string) error {
	if err := validateBackupID(id); err != nil {
		return err
	}
	backupDir := filepath.Join(configBackupsDir(appDataDir), id)
	manifest, err := readManifest(backupDir)
	if err != nil {
		return err
	}

	canonRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("configbackup: resolve root %q: %w", root, err)
	}

	selected := manifest.Files
	wholeProfile := len(relPaths) == 0
	if !wholeProfile {
		want := make(map[string]bool, len(relPaths))
		for _, r := range relPaths {
			want[filepath.Clean(r)] = true
		}
		selected = selected[:0:0]
		for _, e := range manifest.Files {
			if want[filepath.Clean(e.RelPath)] {
				selected = append(selected, e)
			}
		}
	}

	for _, entry := range selected {
		if !matchConfigAllowlist(entry.RelPath) {
			return fmt.Errorf("configbackup: refusing to restore non-allowlisted %q", entry.RelPath)
		}
		data, err := os.ReadFile(filepath.Join(backupDir, entry.RelPath))
		if err != nil {
			return fmt.Errorf("configbackup: read backup file %q: %w", entry.RelPath, err)
		}
		if filepath.Clean(entry.RelPath) == "settings.json" {
			if err := files.ReplaceSettingsJSON(data); err != nil {
				return fmt.Errorf("configbackup: restore settings.json: %w", err)
			}
			continue
		}
		dest, err := confineImportDest(canonRoot, entry.RelPath)
		if err != nil {
			return err
		}
		if err := writeFileWithBak(dest, data); err != nil {
			return fmt.Errorf("configbackup: restore %q: %w", entry.RelPath, err)
		}
	}

	if wholeProfile {
		if err := restoreHooksDisabled(appDataDir, backupDir); err != nil {
			return err
		}
	}
	return nil
}

// confineImportDest resolves a root-relative import/restore destination the same
// way maintenance.confineRestoreDest does for a path that may not exist yet:
// lexical Clean + reject absolute / any ".." segment, then confine the nearest
// EXISTING ancestor via files.Confine (so a swapped symlinked ancestor can't
// redirect the write). files.Confine on the not-yet-existing leaf would be a
// no-op, so the ancestor check is load-bearing.
func confineImportDest(canonRoot, relPath string) (string, error) {
	cleaned := filepath.Clean(relPath)
	if filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("configbackup: dest %q must be relative", relPath)
	}
	for _, seg := range strings.Split(cleaned, string(filepath.Separator)) {
		if seg == ".." {
			return "", fmt.Errorf("configbackup: dest %q escapes root", relPath)
		}
	}

	dest := filepath.Join(canonRoot, cleaned)
	ancestor := filepath.Dir(dest)
	for {
		if _, err := os.Lstat(ancestor); err == nil {
			break
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			return "", fmt.Errorf("configbackup: no existing ancestor for %q", relPath)
		}
		ancestor = parent
	}
	if _, err := files.Confine(ancestor, canonRoot); err != nil {
		return "", err
	}
	return dest, nil
}

// writeFileWithBak writes data to dest via temp+rename, backing up any existing
// dest to dest+".bak" first. The missing tail below the already-confined
// ancestor is created 0o700.
func writeFileWithBak(dest string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return fmt.Errorf("configbackup: mkdir restore parent: %w", err)
	}
	if cur, err := os.ReadFile(dest); err == nil {
		if err := atomicWrite(dest+".bak", cur, 0o644); err != nil {
			return err
		}
	}
	return atomicWrite(dest, data, 0o644)
}

// restoreHooksDisabled overwrites <appDataDir>/hooks-disabled.json from the
// backup's snapshot, if present (whole-profile undo). A backup without the
// snapshot is a no-op.
func restoreHooksDisabled(appDataDir, backupDir string) error {
	data, err := os.ReadFile(filepath.Join(backupDir, hooksDisabledSnapshotName))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("configbackup: read hooks-disabled snapshot: %w", err)
	}
	if err := os.MkdirAll(appDataDir, 0o755); err != nil {
		return fmt.Errorf("configbackup: mkdir app data dir: %w", err)
	}
	dest := filepath.Join(appDataDir, "hooks-disabled.json")
	if cur, err := os.ReadFile(dest); err == nil {
		if err := atomicWrite(dest+".bak", cur, 0o644); err != nil {
			return err
		}
	}
	return atomicWrite(dest, data, 0o644)
}

// atomicWrite writes data to path via temp+rename.
func atomicWrite(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return fmt.Errorf("configbackup: write %s: %w", filepath.Base(tmp), err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("configbackup: rename %s: %w", filepath.Base(tmp), err)
	}
	return nil
}
