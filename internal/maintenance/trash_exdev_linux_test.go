//go:build linux

package maintenance

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// TestTrashItems_EXDEVFallback forces a real cross-device rename by mounting
// a tmpfs as the trash side while root lives on the ordinary test tmp
// filesystem, then trashes a directory containing an internal symlink and a
// 0600 file — the same scenario invariant #4/H2 targets. Mounting requires
// CAP_SYS_ADMIN; skip cleanly wherever that isn't available (unprivileged
// containers, sandboxed CI) rather than fail the suite.
func TestTrashItems_EXDEVFallback(t *testing.T) {
	mountPoint := t.TempDir()
	if err := syscall.Mount("tmpfs", mountPoint, "tmpfs", 0, ""); err != nil {
		t.Skipf("cannot mount tmpfs (needs CAP_SYS_ADMIN): %v", err)
	}
	t.Cleanup(func() { _ = syscall.Unmount(mountPoint, 0) })

	root := t.TempDir()
	appData := mountPoint // trash side forced onto a different filesystem

	dir := filepath.Join(root, "project")
	securePath := filepath.Join(dir, "secret.jsonl")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(securePath, []byte("session data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(securePath, filepath.Join(dir, "alias")); err != nil {
		t.Fatal(err)
	}

	roots := []string{root}
	receipt, err := TrashItems(roots, appData, []string{dir})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}
	if _, err := os.Lstat(dir); err == nil {
		t.Fatal("expected original dir to be gone after EXDEV move")
	}

	storedFile := filepath.Join(appData, "trash", receipt.ID, receipt.Items[0].RelStore, "secret.jsonl")
	info, err := os.Stat(storedFile)
	if err != nil {
		t.Fatalf("stat copied file: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("copied file perm = %o, want 0600", perm)
	}

	storedLink := filepath.Join(appData, "trash", receipt.ID, receipt.Items[0].RelStore, "alias")
	lst, err := os.Lstat(storedLink)
	if err != nil {
		t.Fatalf("lstat copied link: %v", err)
	}
	if lst.Mode()&os.ModeSymlink == 0 {
		t.Fatal("copied entry is not a symlink — dereferenced during EXDEV copy")
	}

	if err := RestoreTrash(roots, appData, receipt.ID); err != nil {
		t.Fatalf("RestoreTrash across EXDEV: %v", err)
	}
	restored, err := os.ReadFile(securePath)
	if err != nil || string(restored) != "session data" {
		t.Fatalf("restored file mismatch: %q err=%v", restored, err)
	}
}
