// Package configbackup implements W24 whole-profile config backup / export /
// import for Claude Code's user-authored files. It is the program's sharpest
// security surface: an imported archive can carry hooks + permission rules =
// arbitrary command execution on the next CLI run. Every path is confined,
// allowlisted, and fail-closed; imported hooks NEVER land in settings.json
// (they are routed to the app-owned, CLI-ignored hooks-disabled.json), and a
// default export strips secrets.
//
// root is the caller's EffectivePath (threaded from the service layer — never a
// hardcoded ~/.claude); appDataDir is the claude-devtools app-data root. The
// backup store lives at <appDataDir>/config-backups/<id>/ (a NEW, non-colliding
// dir — session snapshots own <appDataDir>/snapshots/).
package configbackup

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// Manifest describes one captured config backup on disk (config-backups/<id>/
// manifest.json). Files carries the root-relative allowlisted files; SkillLinks
// records symlinked skills by target string only (their out-of-root content is
// never captured). SecretsIncluded is meaningful on an EXPORT archive's
// manifest (a default export sets it false).
type Manifest struct {
	ID              string      `json:"id"`
	Label           string      `json:"label"`
	CreatedMs       float64     `json:"createdMs"`
	SecretsIncluded bool        `json:"secretsIncluded"`
	Files           []FileEntry `json:"files"`
	SkillLinks      []SkillLink `json:"skillLinks"`
}

// FileEntry is one captured file: its root-relative path, byte size, and
// SHA-256 (hex) checksum of the captured bytes.
type FileEntry struct {
	RelPath string `json:"relPath"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
}

// SkillLink records a symlinked skill by name + raw link target only — never
// its content (an out-of-root repo is a documented non-goal to capture).
type SkillLink struct {
	Name   string `json:"name"`
	Target string `json:"target"`
}

// redactionPlaceholder mirrors files.claudeJSONMask — the marker a
// secrets-excluded export writes in place of a credential. ApplyImport drops
// any imported settings value equal to it rather than writing it live (F11).
// Kept in sync with the files package by hand (that const is unexported).
const redactionPlaceholder = "••••"

// hooksDisabledSnapshotName is the reserved filename a pre-import backup uses
// to snapshot <appDataDir>/hooks-disabled.json, so a one-click undo can fully
// revert the disabled groups an import appended. It is NOT an allowlisted
// config path, so it can never be confused with a root-relative file entry.
const hooksDisabledSnapshotName = "hooks-disabled.snapshot.json"

// configBackupsDir is the app-owned backup store root.
func configBackupsDir(appDataDir string) string {
	return filepath.Join(appDataDir, "config-backups")
}

// nowMS returns the current epoch time in float milliseconds (mirrors
// snapshots.nowMS for a consistent manifest timestamp idiom).
func nowMS() float64 {
	return float64(time.Now().UnixNano()) / 1e6
}

// validateBackupID rejects any id that isn't a single filename-safe segment,
// before it is joined into a store path (DeleteConfigBackup / RestoreConfig /
// ExportBackup take it from the frontend).
func validateBackupID(id string) error {
	if id == "" || id == "." || id == ".." ||
		strings.ContainsRune(id, '/') || strings.ContainsRune(id, filepath.Separator) ||
		filepath.IsAbs(id) || filepath.Clean(id) != id {
		return fmt.Errorf("configbackup: invalid backup id %q", id)
	}
	return nil
}

// matchConfigAllowlist reports whether relPath (root-relative) is a capturable /
// restorable / importable config file. Matching is SEGMENT-BOUNDED — never a
// textual prefix — so a "rules-evil.md" sibling can never pass as "rules/**".
// Every capture, restore, and imported-archive entry is validated here; nothing
// outside this set is ever written. projects/, todos/, caches, and ~/.claude.json
// are absent by construction.
func matchConfigAllowlist(relPath string) bool {
	cleaned := filepath.Clean(relPath)
	if cleaned == "." || filepath.IsAbs(cleaned) {
		return false
	}
	segs := strings.Split(cleaned, string(filepath.Separator))
	for _, s := range segs {
		if s == "" || s == "." || s == ".." {
			return false
		}
	}

	switch cleaned {
	case "settings.json", "CLAUDE.md", "RTK.md":
		return true
	}

	switch segs[0] {
	case "rules", "commands", "tools":
		// rules/**, commands/**, tools/** — any file at any depth (len>=2 => a
		// file below the dir, never the bare dir itself).
		return len(segs) >= 2
	case "agents":
		// agents/*.md — exactly one .md file directly under agents/.
		return len(segs) == 2 && strings.HasSuffix(segs[1], ".md")
	case "projects":
		// projects/<encoded>/memory/*.md — MEMORY.md + fact files.
		return len(segs) == 4 && segs[2] == "memory" && strings.HasSuffix(segs[3], ".md")
	case "agent-memory":
		// agent-memory/<name>/*.md — MEMORY.md + fact files.
		return len(segs) == 3 && strings.HasSuffix(segs[2], ".md")
	case "skills":
		// skills/<name>/SKILL.md, or anything under skills/<name>/references/**.
		if len(segs) == 3 && segs[2] == "SKILL.md" {
			return true
		}
		return len(segs) >= 4 && segs[2] == "references"
	}
	return false
}

// categoryForRel buckets a root-relative allowlisted path into the confirmation
// category the import review screen gates on. An unknown path returns "".
func categoryForRel(rel string) string {
	cleaned := filepath.Clean(rel)
	if cleaned == "settings.json" {
		return "settings"
	}
	if cleaned == "CLAUDE.md" || cleaned == "RTK.md" {
		return "instructions"
	}
	switch strings.Split(cleaned, string(filepath.Separator))[0] {
	case "rules", "commands", "tools":
		return "instructions"
	case "agents":
		return "agents"
	case "projects", "agent-memory":
		return "memory"
	case "skills":
		return "skills"
	}
	return ""
}
