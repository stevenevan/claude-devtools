package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// mustWriteFile creates parent dirs as needed and writes n bytes of content.
func mustWriteFile(t *testing.T, path string, n int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, n), 0o644); err != nil {
		t.Fatal(err)
	}
}

func findUsage(usages []DirUsage, path string) *DirUsage {
	for i := range usages {
		if usages[i].Path == path {
			return &usages[i]
		}
	}
	return nil
}

// TestScanClaudeDir_SymlinkChildNeverFollowed covers two SEC invariants at once:
// a child that is itself a symlink pointing at a directory with known bytes
// OUTSIDE the scanned tree (its bytes must never appear in the total), and a
// symlink cycle nested inside a real child (must not hang or double-count).
func TestScanClaudeDir_SymlinkChildNeverFollowed(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()

	mustWriteFile(t, filepath.Join(outside, "target", "bigfile.bin"), 5000)

	mustWriteFile(t, filepath.Join(root, "childA", "file1.txt"), 10)
	mustWriteFile(t, filepath.Join(root, "childA", "sub", "file2.txt"), 20)
	if err := os.Symlink(filepath.Join(root, "childA"), filepath.Join(root, "childA", "sub", "cyclelink")); err != nil {
		t.Fatal(err)
	}

	if err := os.Symlink(filepath.Join(outside, "target"), filepath.Join(root, "childB")); err != nil {
		t.Fatal(err)
	}

	usages, err := ScanClaudeDir(context.Background(), []string{root}, nil)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}

	childA := findUsage(usages, filepath.Join(root, "childA"))
	if childA == nil {
		t.Fatal("expected a DirUsage row for childA")
	}
	if childA.IsSymlink {
		t.Fatal("childA is a real directory, must not be flagged as a symlink")
	}
	if childA.Bytes != 30 {
		t.Fatalf("childA.Bytes = %d, want 30 (cycle link must not be followed or double-counted)", childA.Bytes)
	}
	if childA.Files != 2 {
		t.Fatalf("childA.Files = %d, want 2", childA.Files)
	}

	childB := findUsage(usages, filepath.Join(root, "childB"))
	if childB == nil {
		t.Fatal("expected a DirUsage row for childB")
	}
	if !childB.IsSymlink {
		t.Fatal("childB is a symlink and must be flagged IsSymlink:true")
	}
	if childB.Bytes != 0 {
		t.Fatalf("childB.Bytes = %d, want 0 — symlink target's bytes must never be counted", childB.Bytes)
	}
}

// TestScanClaudeDir_UnreadableDirDoesNotAbort verifies a permission-denied
// subdirectory surfaces via Err on its containing child, without aborting
// the scan of sibling children.
func TestScanClaudeDir_UnreadableDirDoesNotAbort(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("chmod 000 does not restrict access for windows or a privileged (root) user")
	}

	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "childOK", "file.txt"), 5)

	unreadable := filepath.Join(root, "childC", "locked")
	if err := os.MkdirAll(unreadable, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(unreadable, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(unreadable, 0o755) })

	usages, err := ScanClaudeDir(context.Background(), []string{root}, nil)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}

	childC := findUsage(usages, filepath.Join(root, "childC"))
	if childC == nil {
		t.Fatal("expected a DirUsage row for childC")
	}
	if childC.Err == "" {
		t.Fatal("childC should surface the permission-denied error via Err")
	}

	childOK := findUsage(usages, filepath.Join(root, "childOK"))
	if childOK == nil {
		t.Fatal("scan must not abort: childOK should still be present")
	}
	if childOK.Bytes != 5 || childOK.Err != "" {
		t.Fatalf("childOK should scan clean, got Bytes=%d Err=%q", childOK.Bytes, childOK.Err)
	}
}

// countingCtx wraps a context.Context, counting calls to Err().
type countingCtx struct {
	context.Context
	calls int
}

func (c *countingCtx) Err() error {
	c.calls++
	return c.Context.Err()
}

// cancelAfterCtx reports itself cancelled once `remaining` successful Err()
// checks have been consumed — lets a test deterministically cancel mid-walk
// without relying on real-time races.
type cancelAfterCtx struct {
	context.Context
	remaining int
}

func (c *cancelAfterCtx) Err() error {
	if c.remaining <= 0 {
		return context.Canceled
	}
	c.remaining--
	return c.Context.Err()
}

// TestScanClaudeDir_CancellationReturnsPartial verifies a cancelled ctx
// stops the walk early, returning fewer rows than a full scan alongside a
// non-nil error, instead of either hanging or silently returning everything.
func TestScanClaudeDir_CancellationReturnsPartial(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"childA", "childB", "childC"} {
		mustWriteFile(t, filepath.Join(root, name, "file.txt"), 10)
	}

	counter := &countingCtx{Context: context.Background()}
	full, err := ScanClaudeDir(counter, []string{root}, nil)
	if err != nil {
		t.Fatalf("baseline scan: %v", err)
	}
	if len(full) != 3 {
		t.Fatalf("expected 3 children in baseline scan, got %d", len(full))
	}
	if counter.calls < 2 {
		t.Skip("not enough ctx.Err() checks to deterministically test partial cancellation")
	}

	cancelled := &cancelAfterCtx{Context: context.Background(), remaining: counter.calls / 2}
	partial, err := ScanClaudeDir(cancelled, []string{root}, nil)
	if err == nil {
		t.Fatal("expected a non-nil error when the context is cancelled mid-walk")
	}
	if len(partial) >= len(full) {
		t.Fatalf("expected fewer rows after cancellation: got %d, full scan has %d", len(partial), len(full))
	}
}
