// Package maintenanceservice wires internal/maintenance into the Wails
// service layer: resolves scan/trash roots via internal/config, throttles
// scan-progress events, enforces one in-flight scan at a time, and gates the
// safe-delete engine (trash/restore/empty) behind the local-only SSH check.
// internal/maintenance is pure — no Wails import there.
package maintenanceservice

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"claude-devtools/internal/config"
	"claude-devtools/internal/maintenance"
)

// progressThrottle bounds how often maintenance:scan-progress is emitted —
// never per-entry (projects/ alone can hold 900+ files).
const progressThrottle = 150 * time.Millisecond

// MaintenanceService exposes read-only disk-usage scanning plus the
// safe-delete/trash engine for the claude root + app-data tree.
type MaintenanceService struct {
	ctx       context.Context
	config    *config.ConfigState
	mu        sync.Mutex
	cancel    context.CancelFunc
	sshActive func() bool
}

// New wires the SSH gate (SEC-server-gate): destructive ops (TrashItems,
// RestoreTrash, EmptyTrash) refuse while an SSH session is active, since the
// safe-delete engine must only ever touch the local machine. The caller
// passes a closure over the already-registered SshService pointer (mirrors
// cache.Default()'s shared-pointer injection precedent) — a fresh SshService
// would nil-panic in GetState().
func New(sshActive func() bool) *MaintenanceService {
	return &MaintenanceService{sshActive: sshActive}
}

func (s *MaintenanceService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx
	s.config = &config.ConfigState{}
	return nil
}

// ServiceShutdown cancels any in-flight scan so app-close doesn't leak the
// walk goroutine or emit into a torn-down channel.
func (s *MaintenanceService) ServiceShutdown() error {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

// ScanClaudeDir scans the configured claude root + app-data directory,
// rejecting the call if a scan is already in progress.
func (s *MaintenanceService) ScanClaudeDir() ([]maintenance.DirUsage, error) {
	s.mu.Lock()
	if s.cancel != nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("maintenance: a scan is already in progress")
	}
	scanCtx, cancel := context.WithCancel(s.ctx)
	s.cancel = cancel
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.cancel = nil
		s.mu.Unlock()
		cancel()
	}()

	roots, err := s.resolveRoots()
	if err != nil {
		return nil, err
	}

	return maintenance.ScanClaudeDir(scanCtx, roots, throttledProgress())
}

// CancelScan cancels the in-flight scan, if any. No-op otherwise.
func (s *MaintenanceService) CancelScan() error {
	s.mu.Lock()
	cancel := s.cancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

// resolveRoots returns [effective claude root, app-data dir], de-duping the
// app-data dir when it nests inside the effective root (e.g. a configured
// root of $HOME makes $HOME/.claude-devtools a descendant) so bytes aren't
// double-counted across two top-level roots.
func (s *MaintenanceService) resolveRoots() ([]string, error) {
	effective := s.config.GetClaudeRootInfo().EffectivePath
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return nil, err
	}

	roots := []string{effective}
	rel, err := filepath.Rel(effective, appDataDir)
	isOutsideEffectiveRoot := err != nil || rel == ".." || strings.HasPrefix(rel, "../")
	if isOutsideEffectiveRoot {
		roots = append(roots, appDataDir)
	}
	return roots, nil
}

// errSSHActive mirrors SEC-server-gate: the safe-delete engine operates on
// the local machine only.
var errSSHActive = fmt.Errorf("maintenance operates on the local machine only; disconnect the SSH session first")

// TrashItems moves paths into the trash, muting the file watcher for the
// duration of the batch (frontend/src/renderer/store/listeners/fileChange.ts
// honors maintenance:mute-watcher) so a large batch doesn't storm the
// session-list refresh. L4: s.mu is held for the SSH-gate check AND the
// move so two destructive calls can't interleave.
func (s *MaintenanceService) TrashItems(paths []string) (maintenance.TrashReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return maintenance.TrashReceipt{}, errSSHActive
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

	return maintenance.TrashItems(roots, appDataDir, paths)
}

// ListTrash lists every trash receipt. Read-only: no SSH gate, no mutex.
func (s *MaintenanceService) ListTrash() ([]maintenance.TrashReceipt, error) {
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return nil, err
	}
	return maintenance.ListTrash(appDataDir)
}

// RestoreTrash restores every item in receiptID to its original location.
func (s *MaintenanceService) RestoreTrash(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}

	roots, err := s.resolveRoots()
	if err != nil {
		return err
	}
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return err
	}
	return maintenance.RestoreTrash(roots, appDataDir, id)
}

// EmptyTrash permanently deletes the given receipts.
func (s *MaintenanceService) EmptyTrash(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}

	appDataDir, err := config.AppDataDir()
	if err != nil {
		return err
	}
	return maintenance.EmptyTrash(appDataDir, ids)
}

// throttledProgress builds a progress callback that emits
// maintenance:scan-progress at most once per progressThrottle window.
func throttledProgress() func(dirs int, bytes int64) {
	var lastEmit time.Time
	return func(dirs int, bytes int64) {
		now := time.Now()
		if now.Sub(lastEmit) < progressThrottle {
			return
		}
		lastEmit = now
		emitEvent("maintenance:scan-progress", map[string]any{
			"dirsVisited": dirs,
			"bytes":       bytes,
		})
	}
}

// emitEvent emits a Wails application event, guarded against a nil app.
// Same pattern as systemservice.emitEvent.
func emitEvent(name string, payload any) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit(name, payload)
}
