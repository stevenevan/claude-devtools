// skills_inventory.go is the Week 27 read+write path for global skills under
// <root>/skills/ — a SECURITY-CRITICAL surface because that directory holds
// OUT-OF-ROOT SYMLINKS (live: `slidev -> ../../.agents/skills/slidev`). The
// historic foot-gun this whole program guards against is writing or deleting
// THROUGH such a link into a real repo outside ~/.claude, so the asymmetry here
// is deliberate and load-bearing:
//   - READ (inventory, description, size) MAY follow the link via EvalSymlinks.
//   - WRITE refuses a symlinked skill outright (editing through it would write
//     the outside target).
//   - DELETE (service layer) trashes the LINK entry via ResolveSkillLinkPath —
//     whose result is NEVER EvalSymlinks'd, so os.Rename moves the link, not its
//     target.
//
// root is always the caller's EffectivePath, threaded from the service layer —
// NEVER claudeDir(), mirroring agents_write.go, so a custom-root user's reads,
// writes, and deletes all land in the same tree.
package files

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"
)

// skillsWriteMu is the single mutex for the skill-file write family — one lock,
// not a per-path map — mirroring agentsWriteMu: read-fresh-under-lock kills the
// lost-update race and MaintenanceService's s.mu already serializes at the
// service layer.
var skillsWriteMu sync.Mutex

// skillsDir returns <root>/skills. root is the caller's EffectivePath.
func skillsDir(root string) string {
	return filepath.Join(root, "skills")
}

// SkillInventoryEntry is one row of the skills inventory. IsSymlink is set from
// an os.Lstat of the LINK entry (never followed); the remaining fields describe
// the RESOLVED directory (reads may follow the link — delete/write must not).
type SkillInventoryEntry struct {
	Name          string `json:"name"`
	Description   string `json:"description"`
	IsSymlink     bool   `json:"isSymlink"`
	ResolvedPath  string `json:"resolvedPath"`
	SymlinkTarget string `json:"symlinkTarget"`
	Bytes         int64  `json:"bytes"`
	HasReferences bool   `json:"hasReferences"`
	HasSkillMd    bool   `json:"hasSkillMd"`
}

// validateSkillName rejects any name that isn't a single, filename-safe segment
// (no separators, no . / .., not absolute, already lexically clean) before any
// filesystem call — the exact shape of validateAgentFileBase.
func validateSkillName(name string) error {
	if name == "" || name == "." || name == ".." ||
		strings.ContainsRune(name, '/') || strings.ContainsRune(name, filepath.Separator) ||
		filepath.IsAbs(name) || filepath.Clean(name) != name {
		return fmt.Errorf("files: invalid skill name %q", name)
	}
	return nil
}

// SkillsInventory enumerates <root>/skills/, one SkillInventoryEntry per usable
// entry. Dotfile entries (.DS_Store) are skipped, mirroring ReadGlobalSkills's
// e.Name()[0]=='.' guard. Each entry is os.Lstat'd to set IsSymlink WITHOUT
// following: a symlink is then EvalSymlinks-resolved and skipped unless it
// resolves to a directory; a non-symlink must itself be a directory (bare files
// skipped). Description/HasSkillMd come from SKILL.md under the resolved dir,
// HasReferences from a references/ subdir, and Bytes from a Lstat-based walk of
// the resolved dir that counts symlink children as 0 and skips .bak/.tmp editor
// byproducts. Returns an empty (non-nil) slice when the skills dir is missing.
func SkillsInventory(root string) ([]SkillInventoryEntry, error) {
	dir := skillsDir(root)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []SkillInventoryEntry{}, nil
	}

	out := make([]SkillInventoryEntry, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if len(name) == 0 || name[0] == '.' {
			continue
		}

		linkPath := filepath.Join(dir, name)
		lst, err := os.Lstat(linkPath)
		if err != nil {
			continue
		}
		isSymlink := lst.Mode()&os.ModeSymlink != 0

		var target string
		if isSymlink {
			// os.Readlink reports the raw link text WITHOUT following it; the
			// EvalSymlinks below (read-only) is what actually resolves the target.
			if target, err = os.Readlink(linkPath); err != nil {
				continue
			}
		} else if !lst.IsDir() {
			continue // a bare file under skills/ is not a manageable skill
		}

		resolved, err := filepath.EvalSymlinks(linkPath)
		if err != nil {
			continue // dangling symlink — not a usable skill
		}
		if info, err := os.Stat(resolved); err != nil || !info.IsDir() {
			continue // a symlink to a file/non-dir is not a skill
		}

		desc, hasSkillMd := skillDescription(resolved)
		hasReferences := isDir(filepath.Join(resolved, "references"))

		bytes, err := skillDirBytes(resolved)
		if err != nil {
			return nil, fmt.Errorf("files: measure skill %q: %w", name, err)
		}

		out = append(out, SkillInventoryEntry{
			Name:          name,
			Description:   desc,
			IsSymlink:     isSymlink,
			ResolvedPath:  resolved,
			SymlinkTarget: target,
			Bytes:         bytes,
			HasReferences: hasReferences,
			HasSkillMd:    hasSkillMd,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// skillDescription reads SKILL.md under a resolved skill dir, returning its
// frontmatter description and whether the file exists at all. A resolved dir
// without a SKILL.md (live: shared/) is a utility dir, not a manageable skill.
func skillDescription(resolvedDir string) (desc string, hasSkillMd bool) {
	skillMd := filepath.Join(resolvedDir, "SKILL.md")
	if _, err := os.Stat(skillMd); err != nil {
		return "", false
	}
	content, err := os.ReadFile(skillMd)
	if err != nil {
		return "", true
	}
	return parseFrontmatter(string(content))["description"], true
}

// isDir reports whether path exists and is a directory.
func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// skillDirBytes measures the RESOLVED skill dir's byte size via Lstat/WalkDir
// only (mirroring maintenance.pathBytes): symlink children contribute 0, and
// .bak/.tmp editor byproducts are skipped so an edited skill isn't double-
// counted.
func skillDirBytes(resolvedDir string) (int64, error) {
	var total int64
	err := filepath.WalkDir(resolvedDir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&fs.ModeSymlink != 0 || d.IsDir() {
			return nil
		}
		if ext := filepath.Ext(d.Name()); ext == ".bak" || ext == ".tmp" {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		return nil
	})
	return total, err
}

// ResolveSkillLinkPath validates skillName and returns the confined LINK path
// <canonSkillsDir>/<skillName> — NEVER EvalSymlinks'd, so a caller trashing the
// result (RemoveSkillLink) moves the link entry itself, never the outside target
// it points at. It canonicalizes root and the skills dir and Confine-checks the
// PARENT (skills dir) within root; the skills dir is expected to exist for these
// ops, so a missing one is an error.
func ResolveSkillLinkPath(root, skillName string) (string, error) {
	if err := validateSkillName(skillName); err != nil {
		return "", err
	}

	canonRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("files: skills root %q: %w", root, err)
	}

	parentCanon, err := filepath.EvalSymlinks(skillsDir(canonRoot))
	if err != nil {
		return "", fmt.Errorf("files: skills directory: %w", err)
	}
	if _, err := Confine(parentCanon, canonRoot); err != nil {
		return "", err
	}

	return filepath.Join(parentCanon, skillName), nil
}

// ResolveSkillDirPath validates skillName and returns the confined entry path
// <canonSkillsDir>/<skillName> — the SAME path ResolveSkillLinkPath returns (the
// entry under the skills dir). The two exports differ only in intent: callers
// Lstat the result to branch a real dir (DeleteSkill) from a symlink
// (RemoveSkillLink's job). Kept as distinct names so each service method reads
// for what it means.
func ResolveSkillDirPath(root, skillName string) (string, error) {
	return ResolveSkillLinkPath(root, skillName)
}

// WriteSkillDoc replaces <resolvedDir>/SKILL.md with content byte-for-byte for a
// REAL skill dir only. It locks skillsWriteMu, resolves the confined entry path,
// and os.Lstat's it: a symlink is REFUSED (editing through it would write the
// outside target); a real dir with no existing SKILL.md is REFUSED (never
// fabricate a SKILL.md inside a non-skill folder like shared/). content must be
// valid UTF-8. The write is a blind full-file replace — the block-scalar SKILL.md
// frontmatter is NEVER reserialized — done .bak-first via atomic temp+rename so
// nothing is torn or written through a possible symlink.
// ReadSkillDoc returns a skill's SKILL.md content for display/editing. Unlike
// WriteSkillDoc it MAY follow a symlink (the read/delete asymmetry): a linked
// skill's SKILL.md is still shown read-only. Returns an error if the resolved
// dir has no SKILL.md or the content is not UTF-8.
func ReadSkillDoc(root, skillName string) (string, error) {
	entry, err := ResolveSkillDirPath(root, skillName)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(entry)
	if err != nil {
		return "", fmt.Errorf("files: skill %q: %w", skillName, err)
	}
	data, err := os.ReadFile(filepath.Join(resolved, "SKILL.md"))
	if err != nil {
		return "", fmt.Errorf("files: skill %q has no SKILL.md: %w", skillName, err)
	}
	if !utf8.Valid(data) {
		return "", fmt.Errorf("files: skill %q SKILL.md is not valid UTF-8", skillName)
	}
	return string(data), nil
}

func WriteSkillDoc(root, skillName string, content []byte) error {
	skillsWriteMu.Lock()
	defer skillsWriteMu.Unlock()

	if !utf8.Valid(content) {
		return fmt.Errorf("files: skill %q SKILL.md content is not valid UTF-8", skillName)
	}

	// ResolveSkillLinkPath and ResolveSkillDirPath return the identical confined
	// entry path, so one resolution suffices — the value is both the link to
	// Lstat for the symlink guard AND the real dir to write into.
	entry, err := ResolveSkillDirPath(root, skillName)
	if err != nil {
		return err
	}

	lst, err := os.Lstat(entry)
	if err != nil {
		return fmt.Errorf("files: skill %q: %w", skillName, err)
	}
	if lst.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("files: refusing to edit symlinked skill %q: editing through a symlink writes the outside target", skillName)
	}
	if !lst.IsDir() {
		return fmt.Errorf("files: skill %q is not a directory", skillName)
	}

	skillMd := filepath.Join(entry, "SKILL.md")
	current, err := os.ReadFile(skillMd)
	if err != nil {
		return fmt.Errorf("files: skill %q has no SKILL.md to edit: %w", skillName, err)
	}

	if err := atomicWriteFile(skillMd+".bak", current); err != nil {
		return fmt.Errorf("files: write backup for skill %q: %w", skillName, err)
	}
	if err := atomicWriteFile(skillMd, content); err != nil {
		return fmt.Errorf("files: write skill %q: %w", skillName, err)
	}
	return nil
}
