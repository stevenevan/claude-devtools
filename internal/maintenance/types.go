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

// Candidate is a cleanup candidate surfaced by ScanCategory.
type Candidate struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	Reason string `json:"reason"`
}

// CategorySpec identifies a scan strategy for ScanCategory. Minimal this
// week — one trivial spec proves the shape; the full matcher framework
// (multiple category IDs, patterns, age thresholds, ...) lands in week 2+.
type CategorySpec struct {
	ID string `json:"id"`
}
