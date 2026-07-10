package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScanBackupBinaries(t *testing.T) {
	root := t.TempDir()
	active := filepath.Join(root, "status-line")
	writeFile(t, active, "ACTIVE-BYTES")
	// identical backup (same bytes) and a distinct backup (different bytes).
	writeFile(t, filepath.Join(root, "status-line.bin.bak"), "ACTIVE-BYTES")
	writeFile(t, filepath.Join(root, "status-line.pre-x.bak"), "OLD-DIFFERENT")
	// a hook backup under hooks/
	writeFile(t, filepath.Join(root, "hooks", "caveman.v1.0.0.bak"), "hook")

	spec := CategorySpec{ID: "backup-binaries", Root: root, Now: time.Now(), Active: []string{active}}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}

	byName := map[string]Candidate{}
	for _, c := range cands {
		byName[filepath.Base(c.Path)] = c
		if c.Path == active {
			t.Fatal("active binary must never be a candidate")
		}
	}
	if len(cands) != 3 {
		t.Fatalf("want 3 backup candidates, got %d: %v", len(cands), byName)
	}
	if byName["status-line.bin.bak"].Meta["identical"] != "true" {
		t.Errorf("identical backup should be flagged duplicate: %v", byName["status-line.bin.bak"].Meta)
	}
	if byName["status-line.pre-x.bak"].Meta["identical"] != "false" {
		t.Errorf("distinct backup should be a rollback point: %v", byName["status-line.pre-x.bak"].Meta)
	}
	if byName["status-line.bin.bak"].Group != "status-line" {
		t.Errorf("backup group should be base binary name, got %q", byName["status-line.bin.bak"].Group)
	}
}

func TestRollbackBinary(t *testing.T) {
	root := t.TempDir()
	appData := filepath.Join(root, ".appdata")
	active := filepath.Join(root, "status-line")
	backup := filepath.Join(root, "status-line.pre-x.bak")

	if err := os.WriteFile(active, []byte("CURRENT"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(backup, []byte("ROLLED-BACK"), 0o644); err != nil {
		t.Fatal(err)
	}

	receipt, err := RollbackBinary([]string{root, appData}, appData, active, backup)
	if err != nil {
		t.Fatal(err)
	}

	// Active replaced with backup content, exec bit intact.
	got, err := os.ReadFile(active)
	if err != nil || string(got) != "ROLLED-BACK" {
		t.Fatalf("active not rolled back: %q err=%v", got, err)
	}
	info, err := os.Stat(active)
	if err != nil || info.Mode().Perm()&0o100 == 0 {
		t.Fatalf("active must remain executable, mode=%v err=%v", info.Mode(), err)
	}
	// Previous active preserved in trash (one receipt item, the CURRENT bytes).
	if len(receipt.Items) != 1 {
		t.Fatalf("want 1 trashed item (old active), got %d", len(receipt.Items))
	}

	// Refuses a symlinked active.
	link := filepath.Join(root, "linked")
	if err := os.Symlink(active, link); err == nil {
		if _, err := RollbackBinary([]string{root, appData}, appData, link, backup); err == nil {
			t.Error("rollback must refuse a symlinked active path")
		}
	}
}
