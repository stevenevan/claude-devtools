// configbackup.go hosts the W24 config backup / export / import methods on
// MaintenanceService — kept off service.go, matching agents.go/instructions.go/
// skills.go. MaintenanceService is the right home: it already owns the SSH gate,
// s.mu, and the watcher-mute idiom the restore/import mutations need. root is
// EffectivePath; appDataDir is config.AppDataDir(). The native file dialogs run
// on the desktop app only (application.Get() — the same accessor emitEvent
// uses); the frontend still dual-gates.
package maintenanceservice

import (
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"

	"claude-devtools/internal/config"
	"claude-devtools/internal/configbackup"
)

// CaptureConfig snapshots the current user-authored config into the app-owned
// backup store. SSH-gated + serialized under s.mu.
func (s *MaintenanceService) CaptureConfig(label string) (configbackup.Manifest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return configbackup.Manifest{}, errSSHActive
	}
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return configbackup.Manifest{}, err
	}
	root := s.config.GetClaudeRootInfo().EffectivePath
	return configbackup.CaptureConfig(root, appDataDir, label, false)
}

// ListConfigBackups lists every stored config backup, newest first. Read-only:
// no SSH gate, no mutex.
func (s *MaintenanceService) ListConfigBackups() ([]configbackup.Manifest, error) {
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return nil, err
	}
	return configbackup.ListConfigBackups(appDataDir)
}

// RestoreConfig restores a backup (whole profile when relPaths is empty, else
// the named files) through the sanctioned writers. SSH-gated + serialized under
// s.mu; mutes the file watcher for the batch.
func (s *MaintenanceService) RestoreConfig(id string, relPaths []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return err
	}
	root := s.config.GetClaudeRootInfo().EffectivePath

	emitEvent("maintenance:mute-watcher", map[string]any{"muted": true})
	defer emitEvent("maintenance:mute-watcher", map[string]any{"muted": false})

	return configbackup.RestoreConfig(root, appDataDir, id, relPaths)
}

// DeleteConfigBackup removes one stored backup's dir tree (app-owned store).
// SSH-gated + serialized under s.mu.
func (s *MaintenanceService) DeleteConfigBackup(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return err
	}
	return configbackup.DeleteConfigBackup(appDataDir, id)
}

// ExportBackup packs a backup into a zip the user picks via the native SaveFile
// dialog (secrets stripped unless includeSecrets). A cancelled dialog (empty
// path / error) is a no-op, NOT an error. SSH-gated + serialized under s.mu.
func (s *MaintenanceService) ExportBackup(id string, includeSecrets bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return err
	}

	app := application.Get()
	if app == nil {
		return nil
	}
	dest, err := app.Dialog.SaveFile().
		SetFilename(exportFilename(appDataDir, id)).
		AddFilter("Config archive", "*.zip").
		PromptForSingleSelection()
	if err != nil || dest == "" {
		return nil // user cancel — no-op
	}
	return configbackup.ExportBackup(appDataDir, id, dest, includeSecrets)
}

// ValidateImportDialog opens a native OpenFile dialog, then fail-closed validates
// the chosen archive and returns the review preview. A cancelled dialog returns
// an empty preview (no error). Read-only (no disk writes); no SSH gate.
func (s *MaintenanceService) ValidateImportDialog() (configbackup.ImportPreview, error) {
	app := application.Get()
	if app == nil {
		return configbackup.ImportPreview{}, nil
	}
	path, err := app.Dialog.OpenFile().
		AddFilter("Config archive", "*.zip").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return configbackup.ImportPreview{}, nil // user cancel — empty preview
	}
	return configbackup.ValidateImport(path)
}

// ApplyImport applies the confirmed categories of a validated archive (imported
// hooks land disabled; a pre-import auto-snapshot is taken first). SSH-gated +
// serialized under s.mu; mutes the file watcher for the batch.
func (s *MaintenanceService) ApplyImport(archivePath string, confirmedCategories []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return err
	}
	root := s.config.GetClaudeRootInfo().EffectivePath

	emitEvent("maintenance:mute-watcher", map[string]any{"muted": true})
	defer emitEvent("maintenance:mute-watcher", map[string]any{"muted": false})

	return configbackup.ApplyImport(root, appDataDir, archivePath, confirmedCategories)
}

// exportFilename derives a filename-safe suggested archive name from the
// backup's label, falling back to a generic name.
func exportFilename(appDataDir, id string) string {
	name := "config-backup"
	if backups, err := configbackup.ListConfigBackups(appDataDir); err == nil {
		for _, b := range backups {
			if b.ID == id && b.Label != "" {
				name = b.Label
				break
			}
		}
	}
	name = strings.NewReplacer("/", "-", "\\", "-", ":", "-").Replace(name)
	return name + ".zip"
}
