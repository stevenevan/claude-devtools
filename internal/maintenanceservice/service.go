// Package maintenanceservice wires internal/maintenance into the Wails
// service layer: resolves scan/trash roots via internal/config, throttles
// scan-progress events, enforces one in-flight scan at a time, and gates the
// safe-delete engine (trash/restore/empty) behind the local-only SSH check.
// internal/maintenance is pure — no Wails import there.
package maintenanceservice

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
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

// errUnsafeRoot refuses a category scan when the effective root is the
// filesystem root, the home dir, or an ancestor of home — with such a root the
// whole-tree matchers (junk sweep, empty-dir) would surface machine-wide
// candidates and the trash confinement ("within root") degrades to "anything".
var errUnsafeRoot = fmt.Errorf("maintenance: effective claude root is too broad for cleanup scans")

// ScanCategory runs the registered matcher for a leaf category id (e.g.
// "plugins", "transcripts", "runtime-tasks") and returns its cleanup
// candidates. Read-only: no SSH gate and no scan mutex (the walk is bounded to
// one category subtree). The age cutoff is the persisted per-category override
// or the matcher's built-in default; Now anchors the "modified today" guard.
func (s *MaintenanceService) ScanCategory(id string) ([]maintenance.Candidate, error) {
	effective := s.config.GetClaudeRootInfo().EffectivePath
	if err := refuseSystemRoot(effective); err != nil {
		return nil, err
	}
	appData, err := config.AppDataDir()
	if err != nil {
		return nil, err
	}

	days := maintenance.CutoffDefault(id)
	if override, ok := s.config.GetMaintenanceCutoff(id); ok {
		days = override
	}
	now := time.Now()
	var cutoff time.Time
	if days > 0 {
		cutoff = now.AddDate(0, 0, -days) // AddDate can't overflow like days*24h
	}

	spec := maintenance.CategorySpec{
		ID:      id,
		Root:    effective,
		AppData: appData,
		Cutoff:  cutoff,
		Now:     now,
		Enabled: readEnabledPlugins(effective),
	}
	return maintenance.ScanCategory(s.ctx, spec)
}

// GetMaintenanceCutoff returns the persisted cutoff (days) for a category, or
// the matcher's built-in default when unset.
func (s *MaintenanceService) GetMaintenanceCutoff(id string) (int, error) {
	if days, ok := s.config.GetMaintenanceCutoff(id); ok {
		return days, nil
	}
	return maintenance.CutoffDefault(id), nil
}

// SetMaintenanceCutoff persists a clamped per-category cutoff (days) for the
// week-31 retention engine; this cycle it drives manual scans only.
func (s *MaintenanceService) SetMaintenanceCutoff(id string, days int) error {
	return s.config.SetMaintenanceCutoff(id, days)
}

// refuseSystemRoot rejects "/" , the home dir, and any ancestor of home.
func refuseSystemRoot(root string) error {
	clean := filepath.Clean(root)
	if clean == filepath.Dir(clean) { // filesystem root ("/", "C:\")
		return errUnsafeRoot
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}
	home = filepath.Clean(home)
	if clean == home {
		return errUnsafeRoot
	}
	if rel, err := filepath.Rel(clean, home); err == nil &&
		rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return errUnsafeRoot // clean is an ancestor of home
	}
	return nil
}

// readEnabledPlugins collects the enabledPlugins keys marked true in
// <root>/settings.json. Reads from the effective root (NOT the hardcoded
// ~/.claude of files.ReadGlobalPlugins) so a custom root cross-references
// correctly. Best-effort: a missing/unreadable file yields no enabled keys.
func readEnabledPlugins(root string) []string {
	data, err := os.ReadFile(filepath.Join(root, "settings.json"))
	if err != nil {
		return nil
	}
	var settings map[string]any
	if json.Unmarshal(data, &settings) != nil {
		return nil
	}
	ep, ok := settings["enabledPlugins"].(map[string]any)
	if !ok {
		return nil
	}
	out := []string{}
	for k, v := range ep {
		if b, ok := v.(bool); ok && b {
			out = append(out, k)
		}
	}
	return out
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
