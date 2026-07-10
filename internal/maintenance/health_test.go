package maintenance

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMaintenanceHealth(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, ".last-cleanup"), "2026-07-01")
	writeFile(t, filepath.Join(root, ".last-update-result.json"), `{"status":"ok","version":"1.2.3"}`)
	writeFile(t, filepath.Join(root, ".caveman-active"), "full")
	// daemon.log with many lines to exercise the tail.
	var b strings.Builder
	for i := 0; i < 500; i++ {
		b.WriteString("daemon line\n")
	}
	writeFile(t, filepath.Join(root, "daemon.log"), b.String())

	h, err := MaintenanceHealth(root)
	if err != nil {
		t.Fatal(err)
	}
	if h.LastCleanupMs == 0 || h.LastCleanupRaw != "2026-07-01" {
		t.Errorf("last-cleanup not read: ms=%v raw=%q", h.LastCleanupMs, h.LastCleanupRaw)
	}
	if h.LastUpdateStatus != "ok" || h.LastUpdateVersion != "1.2.3" || h.LastUpdateParseErr {
		t.Errorf("last-update parse wrong: %+v", h)
	}
	if !h.DaemonPresent || len(h.DaemonTail) != daemonTailLines {
		t.Errorf("daemon tail should be last %d lines, got %d", daemonTailLines, len(h.DaemonTail))
	}
	caveman := false
	for _, f := range h.Flags {
		if f.Name == ".caveman-active" && f.Present && f.Content == "full" {
			caveman = true
		}
	}
	if !caveman {
		t.Errorf("caveman flag not read: %+v", h.Flags)
	}
}

func TestMaintenanceHealthMissingAndMalformed(t *testing.T) {
	root := t.TempDir()
	// nothing but a malformed update file.
	if err := os.WriteFile(filepath.Join(root, ".last-update-result.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	h, err := MaintenanceHealth(root)
	if err != nil {
		t.Fatal(err)
	}
	if h.LastCleanupMs != 0 {
		t.Error("missing .last-cleanup should be 0/absent, not an error")
	}
	if !h.LastUpdateParseErr || h.LastUpdateRaw == "" {
		t.Error("malformed update file should set parseErr + keep raw")
	}
	if h.DaemonPresent {
		t.Error("missing daemon.log should not be present")
	}
	// Flags always present in the list (present=false when absent).
	if len(h.Flags) != len(knownFlagFiles) {
		t.Errorf("flags list should always cover the allowlist, got %d", len(h.Flags))
	}
}
