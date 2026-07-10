// text_write.go is the write path for global instruction files (CLAUDE.md,
// RTK.md, rules/, commands/, tools/) that steer every Claude Code session —
// a SECURITY-CRITICAL surface. Every path here funnels through the same
// lexical-clean + confine-PARENT-to-root pipeline as
// internal/maintenance/trash.go's confineParentToRoot: Confine() returns a
// non-existent candidate UNCHANGED with zero containment check (see its own
// doc comment), so guarding the parent — never the not-yet-existing leaf —
// is the only safe way to block a symlinked rules/ escaping root. Do NOT
// weaken this pipeline or bypass it for a new caller.
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

	"claude-devtools/internal/tokenizer"
)

// allowKind discriminates instructionAllowlist entries. allowSegmentGlob
// (e.g. W28's projects/*/memory/**) is a deliberately unbuilt future kind —
// leave the enum extensible, don't add glob matching until it's needed.
type allowKind int

const (
	allowExactFile allowKind = iota
	allowDirPrefix
)

type allowRule struct {
	kind allowKind
	path string
}

// instructionAllowlist is the single, data-driven source of truth for which
// relative paths under the claude root are readable/writable/listable as
// instruction files. Read/write/list all consume it through matchAllowlist
// so the three surfaces can never drift out of sync.
var instructionAllowlist = []allowRule{
	{allowExactFile, "CLAUDE.md"},
	{allowExactFile, "RTK.md"},
	{allowDirPrefix, "rules"},
	{allowDirPrefix, "commands"},
	{allowDirPrefix, "tools"},
}

// matchAllowlist reports whether cleaned (already filepath.Clean'd, relative)
// matches an allowlist entry. Directory-prefix matches are segment-bounded —
// "rules" or "rules/x.md" match, but "rules-evil.md" does NOT — so a
// sibling file crafted to share the "rules" prefix textually is rejected.
func matchAllowlist(cleaned string) bool {
	for _, rule := range instructionAllowlist {
		switch rule.kind {
		case allowExactFile:
			if cleaned == rule.path {
				return true
			}
		case allowDirPrefix:
			if cleaned == rule.path || strings.HasPrefix(cleaned, rule.path+string(filepath.Separator)) {
				return true
			}
		}
	}
	return false
}

// validateRelPath lexically rejects any relPath that isn't already in
// canonical, relative, non-parent-escaping form, THEN checks the allowlist —
// both gates run before any filesystem call.
func validateRelPath(relPath string) (string, error) {
	cleaned := filepath.Clean(relPath)
	if cleaned != relPath || filepath.IsAbs(cleaned) || cleaned == ".." ||
		strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("files: invalid instruction file path %q", relPath)
	}
	if !matchAllowlist(cleaned) {
		return "", fmt.Errorf("files: %q is not in the instruction-file allowlist", relPath)
	}
	return cleaned, nil
}

// ResolveInstructionPath validates relPath (lexical + allowlist) and
// resolves it to an absolute path confined within root, following the
// confineParentToRoot pattern: canonicalize root, create relPath's parent
// directory if missing, then EvalSymlinks + Confine the PARENT (never the
// leaf, which may not exist yet) to block a symlinked rules/ pointing
// outside root. Shared by ReadTextFile, MutateTextFile, and
// maintenanceservice's DeleteInstructionFile so all three enforce identical
// safety.
func ResolveInstructionPath(root, relPath string) (string, error) {
	cleaned, err := validateRelPath(relPath)
	if err != nil {
		return "", err
	}

	canonRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("files: instruction root %q: %w", root, err)
	}

	abs := filepath.Join(canonRoot, cleaned)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", fmt.Errorf("files: create instruction directory: %w", err)
	}

	parentCanon, err := filepath.EvalSymlinks(filepath.Dir(abs))
	if err != nil {
		return "", fmt.Errorf("files: instruction parent directory: %w", err)
	}
	if _, err := Confine(parentCanon, canonRoot); err != nil {
		return "", err
	}

	return filepath.Join(parentCanon, filepath.Base(cleaned)), nil
}

// instructionWriteMu is the single mutex for the whole instruction-file
// family — one lock, not a per-path sync.Map, since MaintenanceService's own
// s.mu already serializes at the service layer and a per-path map would just
// add complexity with no real concurrency benefit here.
var instructionWriteMu sync.Mutex

// MutateTextFile is the atomic read-transform-write primitive every
// instruction-file mutator (WriteTextFile's blind replace today, a future
// frontmatter-aware patch later) routes through. It locks
// instructionWriteMu, resolves and confines relPath, reads the CURRENT bytes
// fresh (never a caller's stale snapshot — closes the read-fresh-under-lock
// TOCTOU window), runs transform, rejects non-UTF-8 output, backs up the
// previous content to relPath+".bak" (only if it existed), and writes the
// new content — both the .bak and the final content via temp+rename inside
// the symlink-resolved parent, never os.WriteFile+O_TRUNC over a dest that
// could itself be a symlink.
func MutateTextFile(root, relPath string, transform func(current []byte) ([]byte, error)) error {
	instructionWriteMu.Lock()
	defer instructionWriteMu.Unlock()

	dest, err := ResolveInstructionPath(root, relPath)
	if err != nil {
		return err
	}

	current, err := os.ReadFile(dest)
	hadCurrent := err == nil
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("files: read %q: %w", relPath, err)
	}
	if !hadCurrent {
		current = nil
	}

	next, err := transform(current)
	if err != nil {
		return err
	}
	if !utf8.Valid(next) {
		return fmt.Errorf("files: refusing to write non-UTF-8 content to %q", relPath)
	}

	if hadCurrent {
		if err := atomicWriteFile(dest+".bak", current); err != nil {
			return fmt.Errorf("files: write backup for %q: %w", relPath, err)
		}
	}
	if err := atomicWriteFile(dest, next); err != nil {
		return fmt.Errorf("files: write %q: %w", relPath, err)
	}
	return nil
}

// WriteTextFile blindly replaces relPath's whole content — the normal
// editor-save path — through MutateTextFile so it shares the same
// lock/confine/backup/atomic-write pipeline as every other instruction-file
// mutator. No format transformation: content is written byte-for-byte,
// trailing newline and all.
func WriteTextFile(root, relPath string, content []byte) error {
	return MutateTextFile(root, relPath, func(_ []byte) ([]byte, error) {
		if !utf8.Valid(content) {
			return nil, fmt.Errorf("files: refusing to write non-UTF-8 content to %q", relPath)
		}
		return content, nil
	})
}

// ReadTextFile returns relPath's raw bytes, applying the same lexical +
// allowlist + confine-parent-to-root safety as MutateTextFile — a read must
// not escape root either. Non-UTF-8 file content is rejected; the editor is
// UTF-8-text-only.
func ReadTextFile(root, relPath string) ([]byte, error) {
	dest, err := ResolveInstructionPath(root, relPath)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(dest)
	if err != nil {
		return nil, fmt.Errorf("files: read %q: %w", relPath, err)
	}
	if !utf8.Valid(data) {
		return nil, fmt.Errorf("files: %q is not valid UTF-8", relPath)
	}
	return data, nil
}

// InstructionFile is one entry in ListInstructionFiles' result: an
// allowlisted file's size and approximate context-window cost.
type InstructionFile struct {
	RelPath      string `json:"relPath"`
	Bytes        int    `json:"bytes"`
	ApproxTokens int    `json:"approxTokens"`
}

// ListInstructionFiles walks every instructionAllowlist entry under root and
// reports each matched file's size + token cost (via
// internal/tokenizer.CountTokens, not a bytes/4 estimate) — the
// context-cost meter's data source. Read-only: a missing root or a missing
// individual allowlist directory yields no entries for it, not an error.
func ListInstructionFiles(root string) ([]InstructionFile, error) {
	canonRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("files: instruction root %q: %w", root, err)
	}

	var out []InstructionFile
	for _, rule := range instructionAllowlist {
		switch rule.kind {
		case allowExactFile:
			if entry, ok := statInstructionFile(canonRoot, rule.path); ok {
				out = append(out, entry)
			}
		case allowDirPrefix:
			entries, err := walkInstructionDir(canonRoot, rule.path)
			if err != nil {
				continue // missing/unreadable directory — nothing to list under it yet
			}
			out = append(out, entries...)
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].RelPath < out[j].RelPath })
	return out, nil
}

func statInstructionFile(canonRoot, relPath string) (InstructionFile, bool) {
	content, err := os.ReadFile(filepath.Join(canonRoot, relPath))
	if err != nil {
		return InstructionFile{}, false
	}
	return InstructionFile{
		RelPath:      relPath,
		Bytes:        len(content),
		ApproxTokens: tokenizer.CountTokens(string(content)),
	}, true
}

// walkInstructionDir lists every file under canonRoot/dirRelPath, skipping
// subdirectories, the write primitive's own ".bak"/".tmp" byproducts (never
// loaded into a session's context, so counting them would misreport the
// meter), and anything matchAllowlist itself would reject.
func walkInstructionDir(canonRoot, dirRelPath string) ([]InstructionFile, error) {
	dirAbs := filepath.Join(canonRoot, dirRelPath)
	if _, err := os.Stat(dirAbs); err != nil {
		return nil, err
	}

	var out []InstructionFile
	err := filepath.WalkDir(dirAbs, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasSuffix(d.Name(), ".bak") || strings.HasSuffix(d.Name(), ".tmp") {
			return nil
		}
		rel, relErr := filepath.Rel(canonRoot, path)
		if relErr != nil || !matchAllowlist(rel) {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		out = append(out, InstructionFile{
			RelPath:      rel,
			Bytes:        len(content),
			ApproxTokens: tokenizer.CountTokens(string(content)),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
