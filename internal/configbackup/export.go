package configbackup

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"claude-devtools/internal/files"
)

// ExportBackup packs backup id into a zip archive at destPath. By default
// (includeSecrets=false) it strips secrets before packing: settings.json goes
// through files.MaskSettingsSecrets (key name AND value shape), and every other
// captured text file is line-scanned through files.RedactSecretLine so a secret
// pasted into CLAUDE.md / an agent / a memory file never ships. The archive
// manifest records SecretsIncluded. Opt-in (includeSecrets=true) packs verbatim
// and flags SecretsIncluded=true. The hooks-disabled snapshot is never exported.
func ExportBackup(appDataDir, id, destPath string, includeSecrets bool) error {
	if err := validateBackupID(id); err != nil {
		return err
	}
	backupDir := filepath.Join(configBackupsDir(appDataDir), id)
	manifest, err := readManifest(backupDir)
	if err != nil {
		return err
	}

	out, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("configbackup: create export %q: %w", destPath, err)
	}
	defer out.Close()
	zw := zip.NewWriter(out)

	exportManifest := Manifest{
		ID:              manifest.ID,
		Label:           manifest.Label,
		CreatedMs:       manifest.CreatedMs,
		SecretsIncluded: includeSecrets,
		Files:           []FileEntry{},
		SkillLinks:      manifest.SkillLinks,
	}
	for _, entry := range manifest.Files {
		data, err := os.ReadFile(filepath.Join(backupDir, entry.RelPath))
		if err != nil {
			_ = zw.Close()
			return fmt.Errorf("configbackup: read backup file %q: %w", entry.RelPath, err)
		}
		if !includeSecrets {
			data = sanitizeForExport(entry.RelPath, data)
		}
		if err := writeZipEntry(zw, entry.RelPath, data); err != nil {
			_ = zw.Close()
			return err
		}
		sum := sha256.Sum256(data)
		exportManifest.Files = append(exportManifest.Files, FileEntry{
			RelPath: entry.RelPath,
			Size:    int64(len(data)),
			SHA256:  hex.EncodeToString(sum[:]),
		})
	}

	manifestBytes, err := json.MarshalIndent(exportManifest, "", "  ")
	if err != nil {
		_ = zw.Close()
		return fmt.Errorf("configbackup: marshal export manifest: %w", err)
	}
	if err := writeZipEntry(zw, "manifest.json", manifestBytes); err != nil {
		_ = zw.Close()
		return err
	}
	if err := zw.Close(); err != nil {
		return fmt.Errorf("configbackup: finish export: %w", err)
	}
	return nil
}

// sanitizeForExport strips secrets from one captured file's bytes: settings.json
// via whole-JSON masking, every other file via per-line token redaction.
func sanitizeForExport(rel string, data []byte) []byte {
	if filepath.Clean(rel) == "settings.json" {
		if masked, err := files.MaskSettingsSecrets(data); err == nil {
			return masked
		}
		// A settings.json that won't parse falls through to line redaction.
	}
	return redactTextBytes(data)
}

// redactTextBytes redacts token-shaped secrets from every line, preserving line
// structure. Returns the input unchanged when nothing matched.
func redactTextBytes(data []byte) []byte {
	lines := strings.Split(string(data), "\n")
	changed := false
	for i, line := range lines {
		if red, ok := files.RedactSecretLine(line); ok {
			lines[i] = red
			changed = true
		}
	}
	if !changed {
		return data
	}
	return []byte(strings.Join(lines, "\n"))
}

// writeZipEntry writes one file into the archive under a forward-slash name.
func writeZipEntry(zw *zip.Writer, relPath string, data []byte) error {
	w, err := zw.Create(filepath.ToSlash(relPath))
	if err != nil {
		return fmt.Errorf("configbackup: create zip entry %q: %w", relPath, err)
	}
	if _, err := w.Write(data); err != nil {
		return fmt.Errorf("configbackup: write zip entry %q: %w", relPath, err)
	}
	return nil
}
