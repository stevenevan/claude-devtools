// agents.go hosts the Week 26 global agent-manager methods
// (<root>/agents/*.md) on MaintenanceService — kept off service.go, matching
// instructions.go. MaintenanceService is the right home: it already owns the
// SSH gate, s.mu, and the trash engine DeleteAgent needs, and every method
// resolves the same EffectivePath root so reads/writes/deletes stay on one
// tree for a custom-root user.
package maintenanceservice

import (
	"claude-devtools/internal/config"
	"claude-devtools/internal/files"
	"claude-devtools/internal/maintenance"
)

// ListManagedAgents enumerates the editable global agents (root-threaded, so
// the list matches what the manager writes for a custom-root user).
// Read-only: no SSH gate.
func (s *MaintenanceService) ListManagedAgents() ([]files.GlobalAgent, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.ReadManagedAgents(root)
}

// PatchAgentFrontmatter applies a typed frontmatter+body patch to one agent
// file. SSH-gated + serialized under s.mu, matching every other mutating
// method on this service.
func (s *MaintenanceService) PatchAgentFrontmatter(fileBase string, patch files.AgentPatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.PatchAgentFrontmatter(root, fileBase, patch)
}

// CreateAgent writes a new agent from the minimal name+description template.
// SSH-gated + serialized under s.mu.
func (s *MaintenanceService) CreateAgent(name, description string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.CreateAgent(root, name, description)
}

// DeleteAgent trashes an agent file (user-authored — trash policy, never
// os.Remove). SSH-gated + serialized under s.mu; calls the PACKAGE-LEVEL
// maintenance.TrashItems (not s.TrashItems) to avoid re-entrant s.mu locking,
// and mutes the file watcher for the move — mirroring DeleteInstructionFile.
func (s *MaintenanceService) DeleteAgent(fileBase string) (maintenance.TrashReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return maintenance.TrashReceipt{}, errSSHActive
	}

	root := s.config.GetClaudeRootInfo().EffectivePath
	dest, err := files.ResolveAgentPath(root, fileBase)
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
