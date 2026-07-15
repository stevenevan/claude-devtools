// memory_write.go is the Week 28 write path for Claude Code memory dirs. Every
// mutation goes through memoryWriteMu (a dedicated lock, never shared), resolves
// the dir by kind-prefixed ID (ResolveMemoryDir — deterministic split, no scan),
// and refuses while <memDir>/.consolidate-lock is present: Claude Code's own
// memory consolidator holds that file while rewriting, and racing it would
// silently clobber its changes last-writer-wins (UNVERIFIED assumption, mitigated
// by .bak + atomic temp+rename so any residual race stays recoverable).
//
// ApplyMemoryIndexFix is byte-exact index surgery — MEMORY.md is re-loaded into
// every future session, so the client's fix is RE-DERIVED server-side from a
// fresh MemoryIntegrity scan and rejected unless an identical finding still
// holds, and only the single proposed line is added/removed; every other byte is
// preserved verbatim.
package files

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"
)

// memoryWriteMu is the single mutex for the whole memory-file family — one lock,
// not a per-path map — mirroring agentsWriteMu/skillsWriteMu: read-fresh-under-
// lock kills the lost-update race and MaintenanceService's s.mu already
// serializes at the service layer.
var memoryWriteMu sync.Mutex

// errMemoryLocked is returned while the consolidator's .consolidate-lock is
// present, so a UI can retry rather than clobber a concurrent consolidation.
var errMemoryLocked = fmt.Errorf("memory consolidation in progress; try again")

// validateMemoryFileName rejects any name that isn't a single ".md" leaf (non-
// empty, .md-suffixed, no separators, no "..", not absolute, lexically clean)
// before any filesystem call.
func validateMemoryFileName(fileName string) error {
	if fileName == "" || fileName == "." || fileName == ".." ||
		!strings.HasSuffix(fileName, ".md") || strings.Contains(fileName, "..") ||
		strings.ContainsRune(fileName, '/') || strings.ContainsRune(fileName, filepath.Separator) ||
		filepath.IsAbs(fileName) || filepath.Clean(fileName) != fileName {
		return fmt.Errorf("files: invalid memory file name %q", fileName)
	}
	return nil
}

// ResolveMemoryFilePath resolves+confines the memory dir (by ID) and joins a
// validated .md leaf under it. The dir is already confined and the leaf is a
// plain filename, so the join needs no further confine.
func ResolveMemoryFilePath(root, dirID, fileName string) (string, error) {
	memDir, _, err := ResolveMemoryDir(root, dirID)
	if err != nil {
		return "", err
	}
	if err := validateMemoryFileName(fileName); err != nil {
		return "", err
	}
	return filepath.Join(memDir, fileName), nil
}

// memoryLockPresent reports whether the consolidator's .consolidate-lock file
// exists in the memory dir.
func memoryLockPresent(memDir string) bool {
	_, err := os.Stat(filepath.Join(memDir, ".consolidate-lock"))
	return err == nil
}

// ReadMemoryFile returns one fact file's content for the editor's load. Rejects
// non-UTF-8 content.
func ReadMemoryFile(root, dirID, fileName string) (string, error) {
	path, err := ResolveMemoryFilePath(root, dirID, fileName)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("files: read memory file %q: %w", fileName, err)
	}
	if !utf8.Valid(data) {
		return "", fmt.Errorf("files: memory file %q is not valid UTF-8", fileName)
	}
	return string(data), nil
}

// WriteMemoryFile replaces a fact file (or MEMORY.md) byte-faithfully — a blind
// full-file write, never a frontmatter reserialize. It locks memoryWriteMu,
// resolves the dir, refuses while the consolidation lock is present, rejects
// non-UTF-8, and .bak's the current bytes (when the file exists) before the
// atomic temp+rename.
func WriteMemoryFile(root, dirID, fileName string, content []byte) error {
	memoryWriteMu.Lock()
	defer memoryWriteMu.Unlock()

	if !utf8.Valid(content) {
		return fmt.Errorf("files: memory file %q content is not valid UTF-8", fileName)
	}

	memDir, _, err := ResolveMemoryDir(root, dirID)
	if err != nil {
		return err
	}
	if memoryLockPresent(memDir) {
		return errMemoryLocked
	}
	if err := validateMemoryFileName(fileName); err != nil {
		return err
	}
	dest := filepath.Join(memDir, fileName)

	if current, err := os.ReadFile(dest); err == nil {
		if err := atomicWriteFile(dest+".bak", current); err != nil {
			return fmt.Errorf("files: write backup for memory file %q: %w", fileName, err)
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("files: read memory file %q: %w", fileName, err)
	}

	if err := atomicWriteFile(dest, content); err != nil {
		return fmt.Errorf("files: write memory file %q: %w", fileName, err)
	}
	return nil
}

// ApplyMemoryIndexFix applies one byte-exact MEMORY.md index edit. It locks
// memoryWriteMu, resolves the dir, refuses under the consolidation lock, then
// RE-DERIVES the fix from a fresh MemoryIntegrity scan: the write proceeds only
// when a finding with an IDENTICAL Fix (same Op+Line) still holds, so a client
// can't inject an arbitrary line. MEMORY.md is read fresh; an "add" appends
// exactly the one line (a single trailing newline), a "remove" drops exactly the
// one matching line — every other byte is preserved. .bak + atomic temp+rename.
func ApplyMemoryIndexFix(root, dirID string, fix MemoryIndexFix) error {
	memoryWriteMu.Lock()
	defer memoryWriteMu.Unlock()

	memDir, _, err := ResolveMemoryDir(root, dirID)
	if err != nil {
		return err
	}
	if memoryLockPresent(memDir) {
		return errMemoryLocked
	}

	report, err := MemoryIntegrity(root, dirID)
	if err != nil {
		return err
	}
	if !fixStillHolds(report, fix) {
		return fmt.Errorf("files: memory index fix is stale (no matching finding)")
	}

	indexPath := filepath.Join(memDir, "MEMORY.md")
	current, err := os.ReadFile(indexPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("files: read memory index: %w", err)
	}

	next, err := applyIndexFix(string(current), fix)
	if err != nil {
		return err
	}

	if len(current) > 0 {
		if err := atomicWriteFile(indexPath+".bak", current); err != nil {
			return fmt.Errorf("files: write backup for memory index: %w", err)
		}
	}
	if err := atomicWriteFile(indexPath, []byte(next)); err != nil {
		return fmt.Errorf("files: write memory index: %w", err)
	}
	return nil
}

// fixStillHolds reports whether a fresh report contains a finding whose Fix is
// byte-identical to the client-supplied fix.
func fixStillHolds(report MemoryReport, fix MemoryIndexFix) bool {
	for _, f := range report.Findings {
		if f.Fix != nil && f.Fix.Op == fix.Op && f.Fix.Line == fix.Line {
			return true
		}
	}
	return false
}

// applyIndexFix dispatches a validated fix onto the current MEMORY.md content.
func applyIndexFix(content string, fix MemoryIndexFix) (string, error) {
	switch fix.Op {
	case "add":
		return appendIndexLine(content, fix.Line), nil
	case "remove":
		return removeIndexLine(content, fix.Line)
	default:
		return "", fmt.Errorf("files: unknown memory index fix op %q", fix.Op)
	}
}

// appendIndexLine appends line to content with exactly one entry line and a
// single trailing newline, inserting a separating newline only when the current
// content doesn't already end in one. All prior bytes are preserved (content is
// a prefix of the result).
func appendIndexLine(content, line string) string {
	var b strings.Builder
	b.WriteString(content)
	if len(content) > 0 && !strings.HasSuffix(content, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString(line)
	b.WriteByte('\n')
	return b.String()
}

// removeIndexLine deletes the FIRST line equal to target (plus its single
// trailing newline, if any), leaving every other byte identical. Returns an
// error if no exact match exists — defensive, since fixStillHolds already
// confirmed the verbatim line came from this same file read.
func removeIndexLine(content, target string) (string, error) {
	idx := 0
	for idx <= len(content) {
		nl := strings.IndexByte(content[idx:], '\n')
		lineEnd, nextStart := len(content), len(content)
		if nl >= 0 {
			lineEnd, nextStart = idx+nl, idx+nl+1
		}
		if content[idx:lineEnd] == target {
			return content[:idx] + content[nextStart:], nil
		}
		if nl < 0 {
			break
		}
		idx = nextStart
	}
	return "", fmt.Errorf("files: memory index line to remove not found")
}
