package configbackup

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// CaptureConfig copies every allowlisted user-authored file under root into
// <appDataDir>/config-backups/<uuid>/ (0o700 dirs, mode-preserving copy),
// SHA-256s each, and writes manifest.json (0o600). Symlinked skills are recorded
// as SkillLink refs (target string only, NO content — an out-of-root repo is a
// documented non-goal). When includeHooksDisabled is set (the pre-import
// auto-snapshot), it ALSO snapshots <appDataDir>/hooks-disabled.json so a
// one-click undo fully reverts the disabled groups an import appended.
func CaptureConfig(root, appDataDir, label string, includeHooksDisabled bool) (Manifest, error) {
	canonRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return Manifest{}, fmt.Errorf("configbackup: resolve root %q: %w", root, err)
	}

	id := uuid.NewString()
	backupDir := filepath.Join(configBackupsDir(appDataDir), id)
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return Manifest{}, fmt.Errorf("configbackup: create backup dir: %w", err)
	}

	rels, skillLinks := collectConfigFiles(canonRoot)

	manifest := Manifest{
		ID:              id,
		Label:           label,
		CreatedMs:       nowMS(),
		SecretsIncluded: false,
		Files:           []FileEntry{},
		SkillLinks:      skillLinks,
	}
	for _, rel := range rels {
		entry, err := copyCaptureFile(canonRoot, backupDir, rel)
		if err != nil {
			return Manifest{}, err
		}
		manifest.Files = append(manifest.Files, entry)
	}

	if includeHooksDisabled {
		if err := captureHooksDisabled(appDataDir, backupDir); err != nil {
			return Manifest{}, err
		}
	}

	if err := writeManifest(backupDir, manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

// collectConfigFiles enumerates every allowlisted file's root-relative path
// under canonRoot plus the symlinked-skill link refs. Every candidate is
// filtered through matchConfigAllowlist so capture can never diverge from
// restore/import.
func collectConfigFiles(canonRoot string) (rels []string, skillLinks []SkillLink) {
	for _, name := range []string{"settings.json", "CLAUDE.md", "RTK.md"} {
		if isRegularFile(filepath.Join(canonRoot, name)) {
			rels = append(rels, name)
		}
	}
	for _, dir := range []string{"rules", "commands", "tools"} {
		rels = append(rels, walkAllowlistedFiles(canonRoot, filepath.Join(canonRoot, dir))...)
	}
	rels = append(rels, listMarkdownFilesRel(canonRoot, filepath.Join(canonRoot, "agents"))...)
	rels = append(rels, collectMemoryFiles(canonRoot, "projects", "memory")...)
	rels = append(rels, collectMemoryFiles(canonRoot, "agent-memory", "")...)

	skillRels, links := collectSkillFiles(canonRoot)
	rels = append(rels, skillRels...)
	return rels, links
}

// collectMemoryFiles lists *.md under <parent>/<name>/<sub> for every child of
// <parent> (sub "" means directly under <name>). Covers projects/*/memory/*.md
// and agent-memory/*/*.md.
func collectMemoryFiles(canonRoot, parent, sub string) []string {
	base := filepath.Join(canonRoot, parent)
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		dir := filepath.Join(base, e.Name())
		if sub != "" {
			dir = filepath.Join(dir, sub)
		}
		out = append(out, listMarkdownFilesRel(canonRoot, dir)...)
	}
	return out
}

// collectSkillFiles captures real skill dirs (SKILL.md + references/**) and
// records symlinked skills as link refs, NEVER following a link (its target may
// live outside root).
func collectSkillFiles(canonRoot string) (rels []string, links []SkillLink) {
	skillsBase := filepath.Join(canonRoot, "skills")
	entries, err := os.ReadDir(skillsBase)
	if err != nil {
		return nil, nil
	}
	for _, e := range entries {
		name := e.Name()
		if len(name) == 0 || name[0] == '.' {
			continue
		}
		linkPath := filepath.Join(skillsBase, name)
		lst, err := os.Lstat(linkPath)
		if err != nil {
			continue
		}
		if lst.Mode()&os.ModeSymlink != 0 {
			if target, err := os.Readlink(linkPath); err == nil {
				links = append(links, SkillLink{Name: name, Target: target})
			}
			continue
		}
		if !lst.IsDir() {
			continue
		}
		if skillMd := filepath.Join(skillsBase, name, "SKILL.md"); isRegularFile(skillMd) {
			if rel, err := filepath.Rel(canonRoot, skillMd); err == nil && matchConfigAllowlist(rel) {
				rels = append(rels, rel)
			}
		}
		rels = append(rels, walkAllowlistedFiles(canonRoot, filepath.Join(skillsBase, name, "references"))...)
	}
	return rels, links
}

// walkAllowlistedFiles recursively lists every regular allowlisted file under
// absDir (skipping symlinks and .bak/.tmp byproducts), returning root-relative
// paths. A missing dir yields nothing.
func walkAllowlistedFiles(canonRoot, absDir string) []string {
	var out []string
	_ = filepath.WalkDir(absDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // missing/unreadable subtree — skip
		}
		if d.IsDir() || d.Type()&fs.ModeSymlink != 0 || isBakTmp(d.Name()) {
			return nil
		}
		rel, relErr := filepath.Rel(canonRoot, path)
		if relErr != nil || !matchConfigAllowlist(rel) {
			return nil
		}
		out = append(out, rel)
		return nil
	})
	return out
}

// listMarkdownFilesRel lists non-symlink *.md files directly in absDir
// (non-recursive), returning allowlisted root-relative paths.
func listMarkdownFilesRel(canonRoot, absDir string) []string {
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() || e.Type()&fs.ModeSymlink != 0 || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		rel, relErr := filepath.Rel(canonRoot, filepath.Join(absDir, e.Name()))
		if relErr != nil || !matchConfigAllowlist(rel) {
			continue
		}
		out = append(out, rel)
	}
	return out
}

// copyCaptureFile copies canonRoot/rel into backupDir/rel (0o700 parents,
// mode-preserving) and returns its FileEntry with the SHA-256 of the bytes.
func copyCaptureFile(canonRoot, backupDir, rel string) (FileEntry, error) {
	src := filepath.Join(canonRoot, rel)
	info, err := os.Lstat(src)
	if err != nil {
		return FileEntry{}, fmt.Errorf("configbackup: stat %q: %w", rel, err)
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return FileEntry{}, fmt.Errorf("configbackup: read %q: %w", rel, err)
	}
	dest := filepath.Join(backupDir, rel)
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return FileEntry{}, fmt.Errorf("configbackup: mkdir for %q: %w", rel, err)
	}
	mode := info.Mode().Perm()
	if err := os.WriteFile(dest, data, mode); err != nil {
		return FileEntry{}, fmt.Errorf("configbackup: write %q: %w", rel, err)
	}
	if err := os.Chmod(dest, mode); err != nil { // WriteFile mode is umask-masked; force-preserve.
		return FileEntry{}, fmt.Errorf("configbackup: chmod %q: %w", rel, err)
	}
	sum := sha256.Sum256(data)
	return FileEntry{RelPath: rel, Size: int64(len(data)), SHA256: hex.EncodeToString(sum[:])}, nil
}

// captureHooksDisabled snapshots <appDataDir>/hooks-disabled.json into the
// backup under the reserved name, if it exists. A missing file is a no-op.
func captureHooksDisabled(appDataDir, backupDir string) error {
	data, err := os.ReadFile(filepath.Join(appDataDir, "hooks-disabled.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("configbackup: read hooks-disabled.json: %w", err)
	}
	if err := os.WriteFile(filepath.Join(backupDir, hooksDisabledSnapshotName), data, 0o600); err != nil {
		return fmt.Errorf("configbackup: snapshot hooks-disabled.json: %w", err)
	}
	return nil
}

// isRegularFile reports whether path is a non-symlink regular file.
func isRegularFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular()
}

// isBakTmp reports whether name is a write-primitive .bak/.tmp byproduct.
func isBakTmp(name string) bool {
	return strings.HasSuffix(name, ".bak") || strings.HasSuffix(name, ".tmp")
}
