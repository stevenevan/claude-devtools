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

	"claude-devtools/internal/cache"
	"claude-devtools/internal/config"
	"claude-devtools/internal/files"
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
	// cache is the shared SessionCache pointer (same instance sessionservice
	// uses) so trashing a session evicts its parsed entry, not a throwaway copy.
	cache *cache.SessionCache
	// raisePending is injected (a closure over NotificationService) so the
	// unattended scheduler can surface a pending-cleanup notification for
	// enabled-but-not-auto-approved categories without importing notifyservice
	// (no cycle). Nil = no notification (tests / no-op).
	raisePending func(categories []string, totalBytes int64) error
	// schedStopCh + schedWg own the W32 scheduler goroutine's lifecycle (LOW-8):
	// the pre-existing shutdown only cancels s.cancel, so these are added to stop
	// + join the ticker cleanly on ServiceShutdown.
	schedStopCh chan struct{}
	schedWg     sync.WaitGroup
}

// New wires the SSH gate (SEC-server-gate): destructive ops (TrashItems,
// RestoreTrash, EmptyTrash) refuse while an SSH session is active, since the
// safe-delete engine must only ever touch the local machine. The caller
// passes a closure over the already-registered SshService pointer (mirrors
// cache.Default()'s shared-pointer injection precedent) — a fresh SshService
// would nil-panic in GetState(). raisePending is a closure over the
// NotificationService pointer for the scheduler's pending-cleanup alerts.
func New(sshActive func() bool, sessionCache *cache.SessionCache, raisePending func(categories []string, totalBytes int64) error) *MaintenanceService {
	return &MaintenanceService{sshActive: sshActive, cache: sessionCache, raisePending: raisePending}
}

func (s *MaintenanceService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx
	s.config = &config.ConfigState{}
	s.startScheduler()
	return nil
}

// ServiceShutdown stops the scheduler goroutine and cancels any in-flight scan
// so app-close doesn't leak a goroutine or emit into a torn-down channel. Order:
// signal the scheduler to stop launching runs, cancel any in-flight run so it
// unwinds between categories, then join the goroutine.
func (s *MaintenanceService) ServiceShutdown() error {
	if s.schedStopCh != nil {
		close(s.schedStopCh)
		s.schedStopCh = nil
	}
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	s.schedWg.Wait()
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

	spec := maintenance.CategorySpec{ID: id, Root: effective, AppData: appData, Cutoff: cutoff, Now: now}
	switch id {
	case "plugins":
		spec.Enabled = readEnabledPlugins(effective)
	case "projects":
		spec.Pinned = s.pinnedSessionIDs()
	case "backup-binaries":
		spec.Active = readActiveBinaries(effective)
	}
	return maintenance.ScanCategory(s.ctx, spec)
}

// pinnedSessionIDs flattens config's per-project pinned sessions to a flat id
// list for the W5 projects matcher's bulk-exclusion cross-reference.
func (s *MaintenanceService) pinnedSessionIDs() []string {
	cfg := s.config.GetConfig()
	out := []string{}
	for _, sessions := range cfg.Sessions.PinnedSessions {
		for _, p := range sessions {
			out = append(out, p.SessionID)
		}
	}
	return out
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

// ReadPlanFile returns the raw contents of a plan file under <root>/plans for
// the W29 read-only markdown view. name is a bare file name (no separators) and
// the resolved path is Confine-checked to plans/ — never an arbitrary-file-read
// primitive (Security M4). Content is capped since plans are text.
func (s *MaintenanceService) ReadPlanFile(name string) (string, error) {
	if name == "" || strings.ContainsRune(name, '/') || strings.ContainsRune(name, filepath.Separator) ||
		name == "." || name == ".." {
		return "", fmt.Errorf("maintenance: invalid plan file name")
	}
	root := s.config.GetClaudeRootInfo().EffectivePath
	plansDir, err := filepath.EvalSymlinks(filepath.Join(root, "plans"))
	if err != nil {
		return "", fmt.Errorf("maintenance: plans dir: %w", err)
	}
	confined, err := files.Confine(filepath.Join(plansDir, name), plansDir)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(confined)
	if err != nil {
		return "", err
	}
	const maxPlanBytes = 2 << 20 // 2 MiB — plans are text
	if len(data) > maxPlanBytes {
		data = data[:maxPlanBytes]
	}
	return string(data), nil
}

// RollbackBinary replaces the active status-line/hook binary at activePath with
// backupPath's contents, preserving the current active in trash. SSH-gated
// under s.mu (calls the package-level primitive, not s.TrashItems, to avoid
// mutex re-entrancy). Never edits settings.json.
func (s *MaintenanceService) RollbackBinary(activePath, backupPath string) (maintenance.TrashReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return maintenance.TrashReceipt{}, errSSHActive
	}

	effective := s.config.GetClaudeRootInfo().EffectivePath
	if !isActiveBinary(effective, activePath) {
		return maintenance.TrashReceipt{}, fmt.Errorf("maintenance: %q is not a currently-active binary", activePath)
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

	return maintenance.RollbackBinary(roots, appDataDir, activePath, backupPath)
}

// readActiveBinaries extracts absolute binary paths referenced by
// <root>/settings.json — statusLine.command plus every nested hooks command
// string. Read from spec.Root, NOT files.ReadGlobalSettings (which hardcodes
// ~/.claude). Best-effort: a missing/unreadable file yields no active paths.
func readActiveBinaries(root string) []string {
	data, err := os.ReadFile(filepath.Join(root, "settings.json"))
	if err != nil {
		return nil
	}
	var settings map[string]any
	if json.Unmarshal(data, &settings) != nil {
		return nil
	}
	commands := []string{}
	if sl, ok := settings["statusLine"].(map[string]any); ok {
		if c, ok := sl["command"].(string); ok {
			commands = append(commands, c)
		}
	}
	collectCommandStrings(settings["hooks"], &commands)

	seen := map[string]bool{}
	out := []string{}
	for _, c := range commands {
		for _, tok := range strings.Fields(c) {
			tok = strings.Trim(tok, "\"'")
			if filepath.IsAbs(tok) && !seen[tok] {
				seen[tok] = true
				out = append(out, tok)
			}
		}
	}
	return out
}

// collectCommandStrings recursively gathers every "command" string value in a
// settings hooks subtree (object/array nesting).
func collectCommandStrings(v any, out *[]string) {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if k == "command" {
				if s, ok := val.(string); ok {
					*out = append(*out, s)
				}
			}
			collectCommandStrings(val, out)
		}
	case []any:
		for _, e := range t {
			collectCommandStrings(e, out)
		}
	}
}

// isActiveBinary reports whether path canonically matches one of the binaries
// the live settings.json references (UX gate; root-confinement in the primitive
// is the real boundary).
func isActiveBinary(root, path string) bool {
	target := canonPathOrClean(path)
	for _, a := range readActiveBinaries(root) {
		if canonPathOrClean(a) == target {
			return true
		}
	}
	return false
}

func canonPathOrClean(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	return filepath.Clean(path)
}

// AnalyzeHistory returns the histogram + prunable counts for history.jsonl
// against the persisted (or default 180-day) cutoff. Read-only: no SSH gate.
func (s *MaintenanceService) AnalyzeHistory() (maintenance.HistoryStats, error) {
	root := s.config.GetClaudeRootInfo().EffectivePath
	cutoff := time.Now().AddDate(0, 0, -s.historyCutoffDays())
	return maintenance.AnalyzeHistory(root, cutoff)
}

// PruneHistory age-outs history.jsonl older than cutoffDays, preserving the
// pruned tail as a restorable, analyzable trash receipt. SSH-gated under s.mu.
func (s *MaintenanceService) PruneHistory(cutoffDays int) (maintenance.TrashReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return maintenance.TrashReceipt{}, errSSHActive
	}

	if err := s.config.SetMaintenanceCutoff("history", cutoffDays); err != nil {
		return maintenance.TrashReceipt{}, err
	}
	days := s.historyCutoffDays()
	root := s.config.GetClaudeRootInfo().EffectivePath
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

	cutoff := time.Now().AddDate(0, 0, -days)
	return maintenance.PruneHistory(roots, appDataDir, filepath.Join(root, "history.jsonl"), cutoff)
}

// historyCutoffDays returns the persisted history cutoff or the 180-day default
// (no matcher is registered for history, so CutoffDefault would return 0).
func (s *MaintenanceService) historyCutoffDays() int {
	if d, ok := s.config.GetMaintenanceCutoff("history"); ok {
		return d
	}
	return 180
}

// ClearFiles irreversibly plain-deletes (or truncates) the given paths — the
// sanctioned path for regenerable logs/caches where a trash copy would wrongly
// extend retention. SSH-gated under s.mu; mutes the watcher for the batch.
func (s *MaintenanceService) ClearFiles(paths []string, truncate bool) error {
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

	emitEvent("maintenance:mute-watcher", map[string]any{"muted": true})
	defer emitEvent("maintenance:mute-watcher", map[string]any{"muted": false})

	return maintenance.ClearFiles(roots, appDataDir, paths, truncate)
}

// GetMaintenanceHealth returns the read-only health snapshot (.last-cleanup,
// .last-update-result.json, daemon.log liveness, mode flags). No SSH gate. The
// W32 scheduler status + app-own last-auto-cleanup are layered on from config
// (the pure reader has no config access).
func (s *MaintenanceService) GetMaintenanceHealth() (maintenance.HealthStatus, error) {
	h, err := maintenance.MaintenanceHealth(s.config.GetClaudeRootInfo().EffectivePath)
	if err != nil {
		return h, err
	}
	h.SchedulerInterval = s.config.GetRetentionPolicy().ScheduleInterval
	h.LastAutoCleanupMs = s.config.GetLastCleanupMs()
	return h, nil
}

// ListSettingsGenerations / ReadSettingsGeneration are read-only (no gate).
func (s *MaintenanceService) ListSettingsGenerations() ([]string, error) {
	return files.ListSettingsGenerations()
}

func (s *MaintenanceService) ReadSettingsGeneration(name string) (string, error) {
	return files.ReadSettingsGeneration(name)
}

// RestoreSettingsGeneration overwrites settings.json with a chosen generation
// (through the atomic .bak-first ReplaceSettingsJSON). Destructive config write:
// SSH-gated + serialized under s.mu.
func (s *MaintenanceService) RestoreSettingsGeneration(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sshActive() {
		return errSSHActive
	}
	return files.RestoreSettingsGeneration(name)
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

	receipt, trashErr := maintenance.TrashItems(roots, appDataDir, paths)
	// Evict/emit off what ACTUALLY moved (receipt.Items), not err==nil — a
	// mid-batch failure still moves some items, which must not leave ghost
	// cache entries or a stale sidebar.
	s.evictTrashedProjects(receipt)
	return receipt, trashErr
}

// evictTrashedProjects invalidates the SessionCache for every project touched
// by a trash batch and emits maintenance:trashed so the frontend refreshes the
// affected session lists once (not per file). ponytail: InvalidateProject keys
// on the encoded dir, which covers single-cwd projects; a split project's
// stale detail entry is benign (the session is gone from the list and never
// re-requested, expiring via TTL/LRU).
func (s *MaintenanceService) evictTrashedProjects(receipt maintenance.TrashReceipt) {
	prefix := filepath.Join(s.config.GetClaudeRootInfo().EffectivePath, "projects") + string(filepath.Separator)
	affected := map[string]bool{}
	for _, item := range receipt.Items {
		if !strings.HasPrefix(item.OrigPath, prefix) {
			continue
		}
		rel := strings.TrimPrefix(item.OrigPath, prefix)
		enc := strings.SplitN(rel, string(filepath.Separator), 2)[0]
		if enc != "" {
			affected[enc] = true
		}
	}
	if len(affected) == 0 {
		return
	}
	list := make([]string, 0, len(affected))
	for enc := range affected {
		if s.cache != nil {
			s.cache.InvalidateProject(enc)
		}
		list = append(list, enc)
	}
	emitEvent("maintenance:trashed", map[string]any{"projects": list})
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
