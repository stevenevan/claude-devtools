// instructions.go hosts the global instruction-file editor methods
// (CLAUDE.md, RTK.md, rules/, commands/, tools/) — kept off the larger
// service.go per ARCH F4. MaintenanceService is the right home: it already
// owns the SSH gate, s.mu, and the trash engine that DeleteInstructionFile
// needs, and resolving EffectivePath here keeps writes/deletes on the same
// root as MaintenanceService's other destructive operations.
package maintenanceservice

import (
	"fmt"
	"path/filepath"
	"strings"

	"claude-devtools/internal/config"
	"claude-devtools/internal/files"
	"claude-devtools/internal/maintenance"
)

// ListInstructionFiles enumerates the editable global instruction files with
// their byte size and approximate token cost — the context-cost meter's data
// source. Read-only: no SSH gate.
func (s *MaintenanceService) ListInstructionFiles() ([]files.InstructionFile, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.ListInstructionFiles(root)
}

// ReadInstructionFile returns one instruction file's content for the editor.
// Read-only: no SSH gate.
func (s *MaintenanceService) ReadInstructionFile(relPath string) (string, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	data, err := files.ReadTextFile(root, relPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteInstructionFile saves the editor's content verbatim (no
// CRLF/whitespace/newline normalization). SSH-gated + serialized under s.mu,
// matching every other mutating method on this service.
func (s *MaintenanceService) WriteInstructionFile(relPath, content string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.WriteTextFile(root, relPath, []byte(content))
}

// deletableInstructionPrefixes is the SERVER-SIDE deletable allowlist (SEC
// L1): narrower than files.instructionAllowlist — CLAUDE.md and RTK.md are
// editable in place but NEVER deletable, no matter what the UI sends.
var deletableInstructionPrefixes = []string{"rules", "commands", "tools"}

// isDeletableInstructionPath reports whether relPath falls under one of the
// deletable directories, segment-bounded like files.matchAllowlist (a
// "rules-evil" sibling must not match "rules").
func isDeletableInstructionPath(relPath string) bool {
	cleaned := filepath.Clean(relPath)
	for _, prefix := range deletableInstructionPrefixes {
		if cleaned == prefix || strings.HasPrefix(cleaned, prefix+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// DeleteInstructionFile trashes an editable rules/commands/tools file.
// SSH-gated + serialized under s.mu; calls the PACKAGE-LEVEL
// maintenance.TrashItems (not s.TrashItems) to avoid re-entrant s.mu
// locking, mirroring RollbackBinary. Mutes the file watcher for the move
// like every other trash-based mutation on this service.
func (s *MaintenanceService) DeleteInstructionFile(relPath string) (maintenance.TrashReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return maintenance.TrashReceipt{}, errSSHActive
	}
	if !isDeletableInstructionPath(relPath) {
		return maintenance.TrashReceipt{}, fmt.Errorf("maintenanceservice: %q is not a deletable instruction file", relPath)
	}

	root := s.config.GetClaudeRootInfo().EffectivePath
	dest, err := files.ResolveInstructionPath(root, relPath)
	if err != nil {
		return maintenance.TrashReceipt{}, err
	}

	roots, err := s.resolveRoots()
	if err != nil {
		return maintenance.TrashReceipt{}, err
	}
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return maintenance.TrashReceipt{}, err
	}

	emitEvent("maintenance:mute-watcher", map[string]any{"muted": true})
	defer emitEvent("maintenance:mute-watcher", map[string]any{"muted": false})

	return maintenance.TrashItems(roots, appDataDir, []string{dest})
}
