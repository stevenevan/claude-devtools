// skills.go hosts the Week 27 global skills-manager methods (<root>/skills/)
// on MaintenanceService — kept off service.go, matching agents.go/
// instructions.go. MaintenanceService is the right home: it already owns the
// SSH gate, s.mu, and the trash engine RemoveSkillLink/DeleteSkill need, and
// every method resolves the same EffectivePath root so reads/writes/deletes
// stay on one tree for a custom-root user.
package maintenanceservice

import (
	"fmt"
	"os"

	"claude-devtools/internal/config"
	"claude-devtools/internal/files"
	"claude-devtools/internal/maintenance"
)

// SkillsInventory enumerates the global skills (real dirs + symlinks), each row
// carrying its resolved path, symlink target, size, and SKILL.md/references
// presence. Read-only: no SSH gate.
func (s *MaintenanceService) SkillsInventory() ([]files.SkillInventoryEntry, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.SkillsInventory(root)
}

// ReadSkillDoc returns a skill's SKILL.md content for the detail view / editor.
// Read-only (no SSH gate); the files layer MAY follow a symlink for reads so a
// linked skill's SKILL.md still renders.
func (s *MaintenanceService) ReadSkillDoc(skillName string) (string, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.ReadSkillDoc(root, skillName)
}

// WriteSkillDoc saves a real skill's SKILL.md verbatim; the files layer refuses
// a symlinked skill or a dir with no existing SKILL.md. SSH-gated + serialized
// under s.mu, matching every other mutating method on this service.
func (s *MaintenanceService) WriteSkillDoc(skillName, content string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	root := s.config.GetClaudeRootInfo().EffectivePath
	return files.WriteSkillDoc(root, skillName, []byte(content))
}

// RemoveSkillLink trashes a skill SYMLINK entry only — the link, never its
// target. It resolves the LINK path (never EvalSymlinks'd) via
// files.ResolveSkillLinkPath, so maintenance.TrashItems (Lstat-based) moves the
// link entry and the out-of-root target it points at is left untouched. SSH-
// gated under s.mu; calls the PACKAGE-LEVEL maintenance.TrashItems (not
// s.TrashItems) to avoid re-entrant s.mu locking, and mutes the file watcher for
// the move — mirroring DeleteInstructionFile.
func (s *MaintenanceService) RemoveSkillLink(skillName string) (maintenance.TrashReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return maintenance.TrashReceipt{}, errSSHActive
	}

	root := s.config.GetClaudeRootInfo().EffectivePath
	dest, err := files.ResolveSkillLinkPath(root, skillName)
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

// DeleteSkill trashes a REAL skill directory. It refuses a symlink entry (that's
// RemoveSkillLink's job) by Lstat'ing the resolved dir path first, so a delete
// can never move a link whose target lives outside root. SSH-gated under s.mu;
// package-level maintenance.TrashItems with watcher-mute, mirroring
// DeleteInstructionFile.
func (s *MaintenanceService) DeleteSkill(skillName string) (maintenance.TrashReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return maintenance.TrashReceipt{}, errSSHActive
	}

	root := s.config.GetClaudeRootInfo().EffectivePath
	dest, err := files.ResolveSkillDirPath(root, skillName)
	if err != nil {
		return maintenance.TrashReceipt{}, err
	}
	lst, err := os.Lstat(dest)
	if err != nil {
		return maintenance.TrashReceipt{}, fmt.Errorf("maintenanceservice: skill %q: %w", skillName, err)
	}
	if lst.Mode()&os.ModeSymlink != 0 {
		return maintenance.TrashReceipt{}, fmt.Errorf("maintenanceservice: skill %q is a symlink; use RemoveSkillLink to remove the link", skillName)
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
