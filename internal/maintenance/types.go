// Package maintenance implements disk-usage scanning and the safe-delete
// (trash/restore/empty) engine for the claude-devtools data tree. Pure
// logic: no application.Get(), no os.UserHomeDir() — roots are resolved by
// the caller (maintenanceservice) via internal/config and injected in.
package maintenance

import "time"

// DirUsage describes disk usage for one immediate child of a scanned root.
// Bytes/Files are aggregated recursively from that child's subtree.
type DirUsage struct {
	Path      string    `json:"path"`
	Bytes     int64     `json:"bytes"`
	Files     int       `json:"files"`
	ModTime   time.Time `json:"modTime"`
	IsSymlink bool      `json:"isSymlink"`
	Err       string    `json:"err,omitempty"`
}

// Candidate is a cleanup candidate surfaced by ScanCategory. Every consumer
// routes destructive action through the week-2 TrashItems engine — a Candidate
// only describes what could be removed, never removes anything itself.
type Candidate struct {
	Path    string    `json:"path"`
	Bytes   int64     `json:"bytes"`
	Files   int       `json:"files"`
	ModTime time.Time `json:"modTime"`
	Reason  string    `json:"reason"`
	// Group is a lexically-sortable UI bucket key (W4 "YYYY-MM" month, W29
	// variant base name, W6/W8/W11 family tag). Empty = ungrouped.
	Group string `json:"group,omitempty"`
	// Meta carries category-specific display context (e.g. enabledBy, session,
	// anomaly). Filesystem-derived — rendered as plain text, never as HTML.
	Meta map[string]string `json:"meta,omitempty"`
}

// CategorySpec parameterizes ScanCategory for one leaf category id (e.g.
// "plugins", "transcripts", "junk-dsstore", "runtime-tasks"). The ID is the
// unit of both dispatch and cutoff persistence. Every field except ID is
// injected by maintenanceservice (json:"-") so matchers stay pure/testable —
// no application.Get(), no os.UserHomeDir(), matching this package's contract.
type CategorySpec struct {
	ID string `json:"id"`
	// Root is the effective claude root (already validated non-system by the
	// service). AppData is the app-data dir, used only to exclude the app's own
	// trash/manifests from whole-root sweeps (W8).
	Root    string `json:"-"`
	AppData string `json:"-"`
	// Cutoff: a candidate must be older than this instant (ModTime.Before) and
	// not modified today. Zero value = no age gate (non-age categories).
	Cutoff time.Time `json:"-"`
	// Now anchors the "modified today" live-session guard; injected for test
	// determinism rather than calling time.Now() inside matchers.
	Now time.Time `json:"-"`
	// Enabled holds enabledPlugins keys for the W3 cross-reference (read from
	// spec.Root, not the hardcoded ~/.claude of ReadGlobalPlugins).
	Enabled []string `json:"-"`
}
