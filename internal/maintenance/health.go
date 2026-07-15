package maintenance

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// daemonTailBytes caps how much of the tail of daemon.log is read — the last N
// lines come from this window, never the whole (potentially huge) file.
const (
	daemonTailBytes = 64 << 10
	daemonTailLines = 40
)

// knownFlagFiles is the allowlist of mode-flag dotfiles the health panel shows —
// never a raw enumeration of every dotfile (avoids surfacing stray names).
var knownFlagFiles = []string{".caveman-active", ".ponytail-active"}

// FlagFile is one known mode-flag dotfile's presence + content.
type FlagFile struct {
	Name    string `json:"name"`
	Present bool   `json:"present"`
	Content string `json:"content"`
}

// HealthStatus is the read-only health snapshot for the W14 panel. Times are
// file mtimes (ms) — a reliable signal regardless of file content format.
type HealthStatus struct {
	LastCleanupMs      float64    `json:"lastCleanupMs"` // .last-cleanup mtime, 0 if absent
	LastCleanupRaw     string     `json:"lastCleanupRaw"`
	LastUpdateRaw      string     `json:"lastUpdateRaw"`
	LastUpdateStatus   string     `json:"lastUpdateStatus"`
	LastUpdateVersion  string     `json:"lastUpdateVersion"`
	LastUpdateParseErr bool       `json:"lastUpdateParseErr"`
	DaemonPresent      bool       `json:"daemonPresent"`
	DaemonLastWriteMs  float64    `json:"daemonLastWriteMs"`
	DaemonTail         []string   `json:"daemonTail"`
	Flags              []FlagFile `json:"flags"`
	// SchedulerInterval + LastAutoCleanupMs are the W32 in-app scheduler status,
	// populated by the service layer from config (this pure reader leaves them
	// zero-valued). SchedulerInterval is "off"|"weekly"|"monthly";
	// LastAutoCleanupMs is the app's OWN last policy-clean run (0 = never).
	SchedulerInterval string  `json:"schedulerInterval"`
	LastAutoCleanupMs float64 `json:"lastAutoCleanupMs"`
}

// MaintenanceHealth reads the four health surfaces read-only (no side effects).
// Missing files yield zero/absent states, never errors.
func MaintenanceHealth(root string) (HealthStatus, error) {
	h := HealthStatus{Flags: []FlagFile{}, DaemonTail: []string{}}

	if info, err := os.Lstat(filepath.Join(root, ".last-cleanup")); err == nil && !info.IsDir() {
		h.LastCleanupMs = float64(info.ModTime().UnixMilli())
		if data, err := os.ReadFile(filepath.Join(root, ".last-cleanup")); err == nil {
			h.LastCleanupRaw = strings.TrimSpace(string(data))
		}
	}

	if data, err := os.ReadFile(filepath.Join(root, ".last-update-result.json")); err == nil {
		h.LastUpdateRaw = strings.TrimSpace(string(data))
		var parsed struct {
			Status  string `json:"status"`
			Version string `json:"version"`
		}
		if json.Unmarshal(data, &parsed) != nil {
			h.LastUpdateParseErr = true
		} else {
			h.LastUpdateStatus = parsed.Status
			h.LastUpdateVersion = parsed.Version
		}
	}

	daemonPath := filepath.Join(root, "daemon.log")
	if info, err := os.Lstat(daemonPath); err == nil && !info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		h.DaemonPresent = true
		h.DaemonLastWriteMs = float64(info.ModTime().UnixMilli())
		h.DaemonTail = tailLines(daemonPath, info.Size())
	}

	for _, name := range knownFlagFiles {
		flag := FlagFile{Name: name}
		if data, err := os.ReadFile(filepath.Join(root, name)); err == nil {
			flag.Present = true
			flag.Content = strings.TrimSpace(string(data))
		}
		h.Flags = append(h.Flags, flag)
	}

	return h, nil
}

// tailLines returns the last daemonTailLines lines of path, reading only the
// final daemonTailBytes window (never the whole file).
func tailLines(path string, size int64) []string {
	f, err := os.Open(path)
	if err != nil {
		return []string{}
	}
	defer f.Close()

	readLen := int64(daemonTailBytes)
	offset := int64(0)
	if size > readLen {
		offset = size - readLen
	} else {
		readLen = size
	}
	buf := make([]byte, readLen)
	if _, err := f.ReadAt(buf, offset); err != nil && err.Error() != "EOF" {
		return []string{}
	}

	lines := strings.Split(strings.TrimRight(string(buf), "\n"), "\n")
	if offset > 0 && len(lines) > 0 {
		lines = lines[1:] // drop the partial first line from mid-file
	}
	if len(lines) > daemonTailLines {
		lines = lines[len(lines)-daemonTailLines:]
	}
	return lines
}
