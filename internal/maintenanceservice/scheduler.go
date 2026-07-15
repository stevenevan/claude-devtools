// scheduler.go hosts the W32 in-app scheduler: an opt-in ticker that runs the
// W31 retention policy UNATTENDED while the app is open (no OS daemon/cron). It
// is load-bearing that every run is consented: only AUTO-APPROVED categories
// execute (through the same SSH-gated executor RunPolicyClean uses), and the
// rest become a pending notification. A missed schedule (app closed over a due
// window) is caught on first wake — the same due-check, run ASYNC in the
// scheduler goroutine, never inline in ServiceStartup (Security F8).
package maintenanceservice

import (
	"context"
	"log/slog"
	"sort"
	"time"

	"claude-devtools/internal/config"
)

// schedulerTick is how often the goroutine wakes to re-evaluate whether a run is
// due. It is intentionally coarse (the due window is days) — the tick only
// bounds catch-up latency, not the schedule itself.
const schedulerTick = time.Hour

// ScheduleStatus is the read-only scheduler snapshot (interval + app-own
// last-run ms). LastRunMs is 0 when a policy clean has never run.
type ScheduleStatus struct {
	Interval  string  `json:"interval"`
	LastRunMs float64 `json:"lastRunMs"`
}

// GetScheduleStatus returns the current interval + last-run timestamp. Read-only.
func (s *MaintenanceService) GetScheduleStatus() (ScheduleStatus, error) {
	policy := s.config.GetRetentionPolicy()
	return ScheduleStatus{Interval: policy.ScheduleInterval, LastRunMs: s.config.GetLastCleanupMs()}, nil
}

// startScheduler launches the ticker goroutine (mirrors watcher.Runner's stopCh
// + WaitGroup idiom). Called from ServiceStartup; stopped + joined in
// ServiceShutdown.
func (s *MaintenanceService) startScheduler() {
	s.schedStopCh = make(chan struct{})
	s.schedWg.Add(1)
	go s.schedulerLoop(s.schedStopCh)
}

// schedulerLoop performs the initial missed-run catch-up ASYNC (its first act,
// off ServiceStartup's thread) then re-checks on every tick until stopped.
func (s *MaintenanceService) schedulerLoop(stop <-chan struct{}) {
	defer s.schedWg.Done()
	defer func() { _ = recover() }() // a scan panic must not crash the app

	s.maybeRunScheduled() // catch-up on first wake (Security F8)

	ticker := time.NewTicker(schedulerTick)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s.maybeRunScheduled()
		}
	}
}

// maybeRunScheduled runs a scheduled clean iff the policy is due.
func (s *MaintenanceService) maybeRunScheduled() {
	if s.config == nil {
		return
	}
	policy := s.config.GetRetentionPolicy()
	if !isScheduleDue(policy.ScheduleInterval, s.config.GetLastCleanupMs(), time.Now()) {
		return
	}
	if err := s.runScheduledClean(); err != nil {
		slog.Warn("maintenance: scheduled cleanup skipped", "err", err)
	}
}

// scheduleDueDuration maps an interval to its due window; "off" (and any unknown
// value) reports (0, false) — never due.
func scheduleDueDuration(interval string) (time.Duration, bool) {
	switch interval {
	case "weekly":
		return 7 * 24 * time.Hour, true
	case "monthly":
		return 30 * 24 * time.Hour, true
	default:
		return 0, false
	}
}

// isScheduleDue reports whether a scheduled run is due: "off" never fires; a
// never-run schedule (lastRunMs<=0) is due immediately (the same catch-up rule);
// otherwise due once now - lastRun >= the interval window.
func isScheduleDue(interval string, lastRunMs float64, now time.Time) bool {
	window, ok := scheduleDueDuration(interval)
	if !ok {
		return false
	}
	if lastRunMs <= 0 {
		return true
	}
	last := time.UnixMilli(int64(lastRunMs))
	return now.Sub(last) >= window
}

// runScheduledClean executes ONE unattended pass: the auto-approved subset runs
// through the SSH-gated executor (trash + receipts + last-run stamp), and the
// enabled-but-not-auto-approved categories become a single pending notification
// linking to their combined dry-run. Plain-delete categories are never touched
// (RunPolicy also excludes them defensively).
func (s *MaintenanceService) runScheduledClean() error {
	policy := s.config.GetRetentionPolicy()
	autoPolicy, pendingIDs := partitionScheduledPolicy(policy)

	if policyHasEnabled(autoPolicy) {
		if _, err := s.runPolicyCleanWith(autoPolicy); err != nil {
			return err // e.g. errSSHActive — refuse the whole unattended run
		}
	}

	if len(pendingIDs) > 0 {
		if err := s.raisePendingReport(policy, pendingIDs); err != nil {
			return err
		}
	}
	return nil
}

// raisePendingReport dry-runs the pending (enabled, not auto-approved) categories
// to size the report, then raises the pending-cleanup notification. Nil
// raisePending (tests / no wiring) makes this a no-op.
func (s *MaintenanceService) raisePendingReport(policy config.RetentionPolicy, pendingIDs []string) error {
	if s.raisePending == nil {
		return nil
	}
	pendingSet := make(map[string]bool, len(pendingIDs))
	for _, id := range pendingIDs {
		pendingSet[id] = true
	}
	pendingPolicy := config.RetentionPolicy{
		Categories:       make(map[string]config.RetentionCategory, len(policy.Categories)),
		TrashExpiryDays:  policy.TrashExpiryDays,
		ScheduleInterval: policy.ScheduleInterval,
	}
	for id, cat := range policy.Categories {
		pendingPolicy.Categories[id] = config.RetentionCategory{Enabled: pendingSet[id], AutoApproved: cat.AutoApproved}
	}

	ctx := s.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	report, err := s.runPolicyWith(ctx, true, pendingPolicy) // dry-run only
	if err != nil {
		return err
	}
	var totalBytes int64
	for _, cr := range report.Categories {
		totalBytes += cr.Bytes
	}
	return s.raisePending(pendingIDs, totalBytes)
}

// partitionScheduledPolicy splits an enabled policy into (a) an auto-approved
// copy safe to run unattended — every category kept but Enabled only for the
// auto-approved ids — and (b) the sorted ids that are enabled but NOT
// auto-approved (→ pending report). Plain-delete ids never appear in either.
func partitionScheduledPolicy(policy config.RetentionPolicy) (config.RetentionPolicy, []string) {
	auto := config.RetentionPolicy{
		Categories:       make(map[string]config.RetentionCategory, len(policy.Categories)),
		TrashExpiryDays:  policy.TrashExpiryDays,
		ScheduleInterval: policy.ScheduleInterval,
	}
	var pending []string
	for id, cat := range policy.Categories {
		runnable := cat.Enabled && !isPlainDeletePolicyID(id)
		switch {
		case runnable && cat.AutoApproved:
			auto.Categories[id] = config.RetentionCategory{Enabled: true, AutoApproved: true}
		case runnable:
			auto.Categories[id] = config.RetentionCategory{Enabled: false, AutoApproved: false}
			pending = append(pending, id)
		default:
			auto.Categories[id] = config.RetentionCategory{Enabled: false, AutoApproved: cat.AutoApproved}
		}
	}
	sort.Strings(pending)
	return auto, pending
}

func policyHasEnabled(policy config.RetentionPolicy) bool {
	for _, cat := range policy.Categories {
		if cat.Enabled {
			return true
		}
	}
	return false
}

// isPlainDeletePolicyID mirrors maintenance.isPlainDeleteID: the irreversible
// ClearFiles categories that the reversible-trash policy must never govern.
func isPlainDeletePolicyID(id string) bool {
	switch id {
	case "logs", "logs-daemon", "caches":
		return true
	}
	return false
}
