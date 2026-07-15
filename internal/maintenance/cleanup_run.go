// Package maintenance — cleanup_run.go composes the per-category cleanups into
// one retention-policy pass (W31). It adds NO new deletion mechanics: every
// destructive step is delegated to an injected closure (Trash / EmptyTrash /
// PruneHistory) so this file never imports the Wails service layer — no import
// cycle — and the same RunPolicy drives both the dry-run preview and the gated
// executor.
package maintenance

import (
	"context"
	"sort"
	"time"

	"claude-devtools/internal/config"
)

// CategoryReport is one policy category's contribution to a Clean-now pass: how
// many candidates, their total bytes, and the paths (expandable in the UI / the
// exact set handed to the Trash closure).
type CategoryReport struct {
	ID    string   `json:"id"`
	Count int      `json:"count"`
	Bytes int64    `json:"bytes"`
	Paths []string `json:"paths"`
}

// CombinedReport aggregates every enabled category plus the count of trash
// receipts the expiry sweep removed (or would remove, in a dry run).
type CombinedReport struct {
	Categories       []CategoryReport `json:"categories"`
	TrashExpiryCount int              `json:"trashExpiryCount"`
}

// RunPolicyOptions injects everything RunPolicy needs from the service layer so
// package maintenance never imports maintenanceservice. The destructive
// closures (Trash/EmptyTrash/PruneHistory) are the ONLY way this pass mutates
// disk — RunPolicy owns composition + ordering, not deletion.
type RunPolicyOptions struct {
	Root       string
	AppDataDir string
	Policy     config.RetentionPolicy
	Now        time.Time
	DryRun     bool

	// CutoffFor resolves a category's age cutoff (days) through the single
	// MaintenanceCutoffs source (Architect HIGH-2) so preview == execution.
	CutoffFor func(id string) int
	// Enrich populates the id-specific spec fields (Enabled/Pinned/Active) the
	// plugins/projects/backup-binaries matchers need — the same enrichment the
	// service's ScanCategory applies. Nil = no enrichment (tests).
	Enrich func(id string, spec *CategorySpec)

	Progress   func(id string)
	Trash      func(paths []string) error
	EmptyTrash func(ids []string) error
	ListTrash  func() ([]TrashReceipt, error)
	// PruneHistory / AnalyzeHistory drive the special-cased history.jsonl path
	// (Metis 5) — it is NOT a ScanCategory matcher.
	PruneHistory   func() (int, error)
	AnalyzeHistory func() (int, error)
}

// RunPolicy executes (or, when DryRun, previews) one retention pass: every
// enabled trash-governed category is scanned and its candidates trashed as one
// receipt, then trash expiry runs LAST. It is cancellable between categories —
// a cancel returns the partial report plus ctx.Err().
func RunPolicy(ctx context.Context, opts RunPolicyOptions) (CombinedReport, error) {
	report := CombinedReport{Categories: []CategoryReport{}}

	for _, id := range sortedPolicyIDs(opts.Policy.Categories) {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		if !opts.Policy.Categories[id].Enabled {
			continue
		}
		// Defensive: the plain-delete ids must never reach the trash loop even
		// if a hand-edited policy lists one — trashing a log/cache wrongly
		// extends its retention (see plaindelete.go / Architect HIGH-1).
		if isPlainDeleteID(id) {
			continue
		}
		if opts.Progress != nil {
			opts.Progress(id)
		}

		if id == "history" {
			if err := runHistoryCategory(&report, opts); err != nil {
				return report, err
			}
			continue
		}

		cr, err := scanPolicyCategory(ctx, id, opts)
		if err != nil {
			return report, err
		}
		report.Categories = append(report.Categories, cr)
		if !opts.DryRun && len(cr.Paths) > 0 {
			if err := opts.Trash(cr.Paths); err != nil {
				return report, err
			}
		}
	}

	if err := ctx.Err(); err != nil {
		return report, err
	}
	expiry, err := runTrashExpiry(opts)
	if err != nil {
		return report, err
	}
	report.TrashExpiryCount = expiry
	return report, nil
}

// scanPolicyCategory scans one trash-governed matcher against its cutoff
// (resolved through the single MaintenanceCutoffs source) and folds the
// candidates into a per-category report.
func scanPolicyCategory(ctx context.Context, id string, opts RunPolicyOptions) (CategoryReport, error) {
	var cutoff time.Time
	if days := opts.CutoffFor(id); days > 0 {
		cutoff = opts.Now.AddDate(0, 0, -days) // AddDate can't overflow like days*24h
	}
	spec := CategorySpec{ID: id, Root: opts.Root, AppData: opts.AppDataDir, Cutoff: cutoff, Now: opts.Now}
	if opts.Enrich != nil {
		opts.Enrich(id, &spec)
	}
	cands, err := ScanCategory(ctx, spec)
	if err != nil {
		return CategoryReport{}, err
	}
	cr := CategoryReport{ID: id, Paths: make([]string, 0, len(cands))}
	for _, c := range cands {
		cr.Count++
		cr.Bytes += c.Bytes
		cr.Paths = append(cr.Paths, c.Path)
	}
	return cr, nil
}

// runHistoryCategory handles the special-cased history.jsonl path: a dry run
// counts prunable lines via AnalyzeHistory; execution prunes (which trashes the
// aged tail) via PruneHistory. Never a ScanCategory matcher (Metis 5).
func runHistoryCategory(report *CombinedReport, opts RunPolicyOptions) error {
	count := 0
	if opts.DryRun {
		n, err := opts.AnalyzeHistory()
		if err != nil {
			return err
		}
		count = n
	} else {
		n, err := opts.PruneHistory()
		if err != nil {
			return err
		}
		count = n
	}
	report.Categories = append(report.Categories, CategoryReport{ID: "history", Count: count, Paths: []string{}})
	return nil
}

// runTrashExpiry runs LAST: it empties every receipt older than the policy's
// expiry window so a same-pass mistake stays restorable until the next pass.
// The window is floored at 1 day (defense-in-depth atop the config clamp) so a
// 0/negative can never purge just-created receipts (Security F5).
func runTrashExpiry(opts RunPolicyOptions) (int, error) {
	receipts, err := opts.ListTrash()
	if err != nil {
		return 0, err
	}
	expiryDays := opts.Policy.TrashExpiryDays
	if expiryDays < 1 {
		expiryDays = 1
	}
	cutoff := opts.Now.Add(-time.Duration(expiryDays) * 24 * time.Hour)

	expired := []string{}
	for _, r := range receipts {
		if r.TrashedAt.Before(cutoff) {
			expired = append(expired, r.ID)
		}
	}
	if len(expired) == 0 || opts.DryRun {
		return len(expired), nil
	}
	if err := opts.EmptyTrash(expired); err != nil {
		return 0, err
	}
	return len(expired), nil
}

func sortedPolicyIDs(cats map[string]config.RetentionCategory) []string {
	ids := make([]string, 0, len(cats))
	for id := range cats {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func isPlainDeleteID(id string) bool {
	switch id {
	case "logs", "logs-daemon", "caches":
		return true
	}
	return false
}
