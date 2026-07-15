package maintenanceservice

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"claude-devtools/internal/config"
	"claude-devtools/internal/maintenance"
)

// PreviewPolicyClean returns the combined dry-run report for the W31 retention
// policy: every enabled category's candidate count/bytes/paths plus how many
// trash receipts the expiry sweep would remove. Read-only — no SSH gate, no run
// mutex (the per-category scans are bounded and mutate nothing).
func (s *MaintenanceService) PreviewPolicyClean() (maintenance.CombinedReport, error) {
	ctx := s.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return s.runPolicy(ctx, true)
}

// RunPolicyClean executes the retention policy: trash-governed categories are
// scanned and trashed (one receipt each), history.jsonl is pruned, then trash
// expiry runs last. It does NOT hold s.mu for the whole multi-category run — it
// briefly takes s.mu to claim s.cancel (reject-if-busy, mirroring
// ScanClaudeDir), then the per-category Trash closure re-locks s.mu for the
// SSH-check + move, releasing between categories so CancelPolicyClean /
// ctx-cancel can interject (Architect MEDIUM-4).
func (s *MaintenanceService) RunPolicyClean() (maintenance.CombinedReport, error) {
	return s.runPolicyCleanWith(s.config.GetRetentionPolicy())
}

// runPolicyCleanWith is the SSH-gated executor shared by the manual Clean-now
// (full policy) and the unattended scheduler (auto-approved-only policy copy).
// It is the SOLE destructive path: it claims s.cancel (reject-if-busy), refuses
// under sshActive(), mutes the watcher, drives the policy, and records the
// last-run timestamp. The scheduler MUST route through here so its unattended
// run is gated identically (Security F8) — never raw maintenance.RunPolicy.
func (s *MaintenanceService) runPolicyCleanWith(policy config.RetentionPolicy) (maintenance.CombinedReport, error) {
	s.mu.Lock()
	if s.cancel != nil {
		s.mu.Unlock()
		return maintenance.CombinedReport{}, fmt.Errorf("maintenance: a scan or cleanup is already in progress")
	}
	runCtx, cancel := context.WithCancel(s.ctx)
	s.cancel = cancel
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.cancel = nil
		s.mu.Unlock()
		cancel()
	}()

	// Up-front SSH gate (the per-category Trash closure re-checks under s.mu).
	if s.sshActive() {
		return maintenance.CombinedReport{}, errSSHActive
	}

	emitEvent("maintenance:mute-watcher", map[string]any{"muted": true})
	defer emitEvent("maintenance:mute-watcher", map[string]any{"muted": false})

	report, err := s.runPolicyWith(runCtx, false, policy)
	if err == nil {
		_ = s.config.SetLastCleanupMs(nowMillis())
	}
	return report, err
}

// CancelPolicyClean interrupts an in-flight policy run (or scan) between
// categories, reusing the same s.cancel mechanism as CancelScan.
func (s *MaintenanceService) CancelPolicyClean() error {
	return s.CancelScan()
}

// runPolicy resolves roots/policy/closures and drives maintenance.RunPolicy in
// either dry-run (preview) or execute mode. The destructive closures inject the
// SSH-gated + s.mu-serialized trash/empty/prune units so package maintenance
// never imports the service layer (no cycle).
func (s *MaintenanceService) runPolicy(ctx context.Context, dryRun bool) (maintenance.CombinedReport, error) {
	return s.runPolicyWith(ctx, dryRun, s.config.GetRetentionPolicy())
}

// runPolicyWith drives maintenance.RunPolicy for an explicit policy (the
// scheduler passes an auto-approved-only or pending-only copy). runPolicy is the
// thin wrapper that reads the full persisted policy.
func (s *MaintenanceService) runPolicyWith(ctx context.Context, dryRun bool, policy config.RetentionPolicy) (maintenance.CombinedReport, error) {
	effective := s.config.GetClaudeRootInfo().EffectivePath
	if err := refuseSystemRoot(effective); err != nil {
		return maintenance.CombinedReport{}, err
	}
	appData, err := config.AppDataDir()
	if err != nil {
		return maintenance.CombinedReport{}, err
	}
	roots, err := s.resolveRoots()
	if err != nil {
		return maintenance.CombinedReport{}, err
	}

	opts := maintenance.RunPolicyOptions{
		Root:           effective,
		AppDataDir:     appData,
		Policy:         policy,
		Now:            time.Now(),
		DryRun:         dryRun,
		CutoffFor:      s.policyCutoffDays,
		Enrich:         s.enrichPolicySpec(effective),
		Progress:       func(id string) { emitEvent("maintenance:scan-progress", map[string]any{"category": id}) },
		Trash:          s.policyTrash(roots, appData),
		EmptyTrash:     s.policyEmptyTrash(appData),
		ListTrash:      func() ([]maintenance.TrashReceipt, error) { return maintenance.ListTrash(appData) },
		PruneHistory:   s.policyPruneHistory(roots, appData, effective),
		AnalyzeHistory: s.policyAnalyzeHistory(effective),
	}
	return maintenance.RunPolicy(ctx, opts)
}

// policyCutoffDays resolves a category's cutoff the SAME way ScanCategory does:
// the persisted MaintenanceCutoffs override, else the matcher's built-in
// default — the single source of truth (Architect HIGH-2).
func (s *MaintenanceService) policyCutoffDays(id string) int {
	if days, ok := s.config.GetMaintenanceCutoff(id); ok {
		return days
	}
	return maintenance.CutoffDefault(id)
}

// enrichPolicySpec mirrors ScanCategory's id-specific spec enrichment so a
// policy scan surfaces the exact same candidates a manual per-category scan
// does (active binaries / enabled plugins / pinned sessions stay protected).
func (s *MaintenanceService) enrichPolicySpec(effective string) func(string, *maintenance.CategorySpec) {
	return func(id string, spec *maintenance.CategorySpec) {
		switch id {
		case "plugins":
			spec.Enabled = readEnabledPlugins(effective)
		case "projects":
			spec.Pinned = s.pinnedSessionIDs()
		case "backup-binaries":
			spec.Active = readActiveBinaries(effective)
		}
	}
}

// policyTrash is the per-category destructive unit: it re-locks s.mu for the
// SSH-check + move (released between categories so a cancel can interject) and
// calls the package primitive directly — the watcher is muted once by
// RunPolicyClean, so this must not re-mute.
func (s *MaintenanceService) policyTrash(roots []string, appData string) func([]string) error {
	return func(paths []string) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.sshActive() {
			return errSSHActive
		}
		receipt, err := maintenance.TrashItems(roots, appData, paths)
		s.evictTrashedProjects(receipt)
		return err
	}
}

func (s *MaintenanceService) policyEmptyTrash(appData string) func([]string) error {
	return func(ids []string) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.sshActive() {
			return errSSHActive
		}
		return maintenance.EmptyTrash(appData, ids)
	}
}

// policyPruneHistory prunes history.jsonl against its cutoff, trashing the aged
// tail. "nothing older than the cutoff" is a no-op (count 0), not a run
// failure. Returns the number of trashed tail items.
func (s *MaintenanceService) policyPruneHistory(roots []string, appData, effective string) func() (int, error) {
	return func() (int, error) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.sshActive() {
			return 0, errSSHActive
		}
		cutoff := time.Now().AddDate(0, 0, -s.historyCutoffDays())
		receipt, err := maintenance.PruneHistory(roots, appData, filepath.Join(effective, "history.jsonl"), cutoff)
		if err != nil {
			if strings.Contains(err.Error(), "nothing older than the cutoff") {
				return 0, nil
			}
			return 0, err
		}
		return len(receipt.Items), nil
	}
}

func (s *MaintenanceService) policyAnalyzeHistory(effective string) func() (int, error) {
	return func() (int, error) {
		cutoff := time.Now().AddDate(0, 0, -s.historyCutoffDays())
		stats, err := maintenance.AnalyzeHistory(effective, cutoff)
		if err != nil {
			return 0, err
		}
		return stats.PrunableLines, nil
	}
}

// nowMillis returns ms since the Unix epoch as float64, matching config's
// timestamp convention for LastCleanupMs.
func nowMillis() float64 {
	return float64(time.Now().UnixNano()) / 1e6
}
