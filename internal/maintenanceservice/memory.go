// memory.go hosts the Week 28 memory-manager methods (per-project memory/ +
// agent-memory/) on MaintenanceService — kept off service.go, matching
// agents.go/skills.go/instructions.go. MaintenanceService is the right home: it
// already owns the SSH gate, s.mu, and the trash engine DeleteMemoryFile needs,
// and every method resolves the same EffectivePath root so reads/writes/deletes
// stay on one tree for a custom-root user. Dirs are addressed by kind-prefixed
// ID (never a client path), so the files layer's deterministic resolver is the
// only place a path is derived.
package maintenanceservice

import (
	"claude-devtools/internal/config"
	"claude-devtools/internal/files"
	"claude-devtools/internal/maintenance"
)

// ListMemoryDirs enumerates the addressable memory dirs (per-project + per-agent)
// with kind-prefixed IDs. Read-only: no SSH gate.
func (s *MaintenanceService) ListMemoryDirs() ([]files.MemoryDir, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.ListMemoryDirs(root)
}

// MemoryIntegrity returns one dir's fact files + the four integrity finding
// kinds (orphan/dangling-index/dangling-link/duplicate-slug). Read-only: no SSH
// gate, no filesystem writes.
func (s *MaintenanceService) MemoryIntegrity(dirID string) (files.MemoryReport, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.MemoryIntegrity(root, dirID)
}

// ReadMemoryFile returns one fact file's content for the editor's load.
// Read-only: no SSH gate.
func (s *MaintenanceService) ReadMemoryFile(dirID, fileName string) (string, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.ReadMemoryFile(root, dirID, fileName)
}

// WriteMemoryFile saves a fact file verbatim; the files layer refuses while the
// consolidation lock is present. SSH-gated + serialized under s.mu, matching
// every other mutating method on this service.
func (s *MaintenanceService) WriteMemoryFile(dirID, fileName, content string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.WriteMemoryFile(root, dirID, fileName, []byte(content))
}

// ApplyMemoryIndexFix applies one byte-exact MEMORY.md index edit; the files
// layer re-derives the fix from a fresh integrity scan and refuses under the
// consolidation lock. SSH-gated + serialized under s.mu.
func (s *MaintenanceService) ApplyMemoryIndexFix(dirID string, fix files.MemoryIndexFix) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.ApplyMemoryIndexFix(root, dirID, fix)
}

// DeleteMemoryFile trashes a fact file (user-authored — trash policy, never
// os.Remove). SSH-gated + serialized under s.mu; calls the PACKAGE-LEVEL
// maintenance.TrashItems (not s.TrashItems) to avoid re-entrant s.mu locking,
// and mutes the file watcher for the move — mirroring DeleteInstructionFile.
func (s *MaintenanceService) DeleteMemoryFile(dirID, fileName string) (maintenance.TrashReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return maintenance.TrashReceipt{}, errSSHActive
	}

	root := s.config.GetClaudeRootInfo().EffectivePath
	dest, err := files.ResolveMemoryFilePath(root, dirID, fileName)
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
