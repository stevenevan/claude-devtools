package maintenance

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
)

// setupTrash creates a fresh root + app-data temp dir pair for one test.
func setupTrash(t *testing.T) (root, appData string) {
	t.Helper()
	root = t.TempDir()
	appData = t.TempDir()
	return root, appData
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); err != nil {
		t.Fatalf("expected %q to exist: %v", path, err)
	}
}

func mustNotExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); err == nil {
		t.Fatalf("expected %q to not exist", path)
	}
}

// TestTrashItems_EtcHostsRejected covers the exact exit-criteria wording:
// an out-of-root system path is refused and untouched.
func TestTrashItems_EtcHostsRejected(t *testing.T) {
	before, err := os.ReadFile("/etc/hosts")
	if err != nil {
		t.Skip("/etc/hosts not readable in this environment")
	}

	root, appData := setupTrash(t)
	_, err = TrashItems([]string{root}, appData, []string{"/etc/hosts"})
	if err == nil {
		t.Fatal("expected an error trashing /etc/hosts")
	}

	after, err := os.ReadFile("/etc/hosts")
	if err != nil {
		t.Fatalf("re-reading /etc/hosts: %v", err)
	}
	if string(before) != string(after) {
		t.Fatal("/etc/hosts content changed — trash touched an out-of-root file")
	}
}

// TestTrashItems_OutOfRootRejected uses two disjoint temp dirs (no reliance
// on system files) to cover the same confinement rule generally.
func TestTrashItems_OutOfRootRejected(t *testing.T) {
	root, appData := setupTrash(t)
	outside := t.TempDir()
	target := filepath.Join(outside, "secret.txt")
	mustWrite(t, target, "do not touch")

	_, err := TrashItems([]string{root}, appData, []string{target})
	if err == nil {
		t.Fatal("expected an error trashing a path outside root")
	}
	mustExist(t, target)
}

// TestTrashItems_SymlinkTargetOutsideRootIntact covers SEC-symlink: trashing
// a symlink whose target lives outside root removes only the link.
func TestTrashItems_SymlinkTargetOutsideRootIntact(t *testing.T) {
	root, appData := setupTrash(t)
	outside := t.TempDir()
	targetFile := filepath.Join(outside, "target", "bigfile.bin")
	mustWrite(t, targetFile, "0123456789")

	link := filepath.Join(root, "link")
	if err := os.Symlink(filepath.Join(outside, "target"), link); err != nil {
		t.Fatal(err)
	}

	receipt, err := TrashItems([]string{root}, appData, []string{link})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}

	mustNotExist(t, link)
	mustExist(t, targetFile) // target untouched

	if len(receipt.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(receipt.Items))
	}
	if receipt.Items[0].Bytes != 0 {
		t.Fatalf("symlink item Bytes = %d, want 0 (never follow the target)", receipt.Items[0].Bytes)
	}

	// The trashed entry must itself still be a symlink pointing at the
	// original (untouched) target, not a copy of its contents.
	stored := filepath.Join(appData, "trash", receipt.ID, receipt.Items[0].RelStore)
	lst, err := os.Lstat(stored)
	if err != nil {
		t.Fatalf("stat trashed link: %v", err)
	}
	if lst.Mode()&os.ModeSymlink == 0 {
		t.Fatal("trashed entry is not a symlink — target may have been dereferenced")
	}
	dest, err := os.Readlink(stored)
	if err != nil {
		t.Fatalf("readlink: %v", err)
	}
	if dest != filepath.Join(outside, "target") {
		t.Fatalf("symlink target changed: got %q", dest)
	}
}

// TestTrashItems_NoNestRejected: a directory and a path inside it in one
// batch must be rejected wholesale — nothing moves.
func TestTrashItems_NoNestRejected(t *testing.T) {
	root, appData := setupTrash(t)
	dir := filepath.Join(root, "foo")
	inner := filepath.Join(dir, "bar.txt")
	mustWrite(t, inner, "x")

	_, err := TrashItems([]string{root}, appData, []string{dir, inner})
	if err == nil {
		t.Fatal("expected nesting rejection")
	}
	mustExist(t, dir)
	mustExist(t, inner)
}

// TestTrashItems_SelfNukeRejected: root, appdata, and the trash tree itself
// must all be refused as inputs.
func TestTrashItems_SelfNukeRejected(t *testing.T) {
	root, appData := setupTrash(t)

	if _, err := TrashItems([]string{root}, appData, []string{root}); err == nil {
		t.Fatal("expected root self-nuke to be rejected")
	}
	if _, err := TrashItems([]string{root}, appData, []string{appData}); err == nil {
		t.Fatal("expected app-data self-nuke to be rejected")
	}

	// Seed one legitimate receipt, then try to trash the trash tree itself.
	seedFile := filepath.Join(root, "seed.txt")
	mustWrite(t, seedFile, "x")
	receipt, err := TrashItems([]string{root}, appData, []string{seedFile})
	if err != nil {
		t.Fatalf("seed trash: %v", err)
	}
	trashTree := filepath.Join(appData, "trash", receipt.ID)
	if _, err := TrashItems([]string{root}, appData, []string{trashTree}); err == nil {
		t.Fatal("expected trashing the trash tree itself to be rejected")
	}
}

// TestTrashItems_MixedRootSameBasenameNoCollision covers MUST-3: two roots
// each holding a same-named file must not collide under one receipt, and
// each restores back to its own root.
func TestTrashItems_MixedRootSameBasenameNoCollision(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	appData := t.TempDir()

	fileA := filepath.Join(rootA, "notes.txt")
	fileB := filepath.Join(rootB, "notes.txt")
	mustWrite(t, fileA, "from A")
	mustWrite(t, fileB, "from B")

	roots := []string{rootA, rootB}
	receipt, err := TrashItems(roots, appData, []string{fileA, fileB})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}
	if len(receipt.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(receipt.Items))
	}
	if receipt.Items[0].RelStore == receipt.Items[1].RelStore {
		t.Fatalf("RelStore collision: both items stored at %q", receipt.Items[0].RelStore)
	}
	mustNotExist(t, fileA)
	mustNotExist(t, fileB)

	if err := RestoreTrash(roots, appData, receipt.ID); err != nil {
		t.Fatalf("RestoreTrash: %v", err)
	}
	gotA, err := os.ReadFile(fileA)
	if err != nil || string(gotA) != "from A" {
		t.Fatalf("fileA restore mismatch: content=%q err=%v", gotA, err)
	}
	gotB, err := os.ReadFile(fileB)
	if err != nil || string(gotB) != "from B" {
		t.Fatalf("fileB restore mismatch: content=%q err=%v", gotB, err)
	}
}

// TestTrashItems_DirectoryRoundTrip: a whole subtree trashed and restored
// must reconstruct exactly, and the spent receipt disappears from ListTrash.
func TestTrashItems_DirectoryRoundTrip(t *testing.T) {
	root, appData := setupTrash(t)
	dir := filepath.Join(root, "project")
	mustWrite(t, filepath.Join(dir, "a.txt"), "alpha")
	mustWrite(t, filepath.Join(dir, "sub", "b.txt"), "beta")

	roots := []string{root}
	receipt, err := TrashItems(roots, appData, []string{dir})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}
	mustNotExist(t, dir)

	list, err := ListTrash(appData)
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(list) != 1 || list[0].ID != receipt.ID {
		t.Fatalf("expected receipt %q in ListTrash, got %+v", receipt.ID, list)
	}

	if err := RestoreTrash(roots, appData, receipt.ID); err != nil {
		t.Fatalf("RestoreTrash: %v", err)
	}

	gotA, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	if err != nil || string(gotA) != "alpha" {
		t.Fatalf("a.txt mismatch: %q err=%v", gotA, err)
	}
	gotB, err := os.ReadFile(filepath.Join(dir, "sub", "b.txt"))
	if err != nil || string(gotB) != "beta" {
		t.Fatalf("sub/b.txt mismatch: %q err=%v", gotB, err)
	}

	list, err = ListTrash(appData)
	if err != nil {
		t.Fatalf("ListTrash after restore: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("expected the spent receipt to be gone, got %+v", list)
	}
}

// TestRestoreTrash_ReceiptIDPatternRejected covers MUST-1/L5: a
// non-UUID-shaped id is rejected by pattern validation before any path is built.
func TestRestoreTrash_ReceiptIDPatternRejected(t *testing.T) {
	root, appData := setupTrash(t)
	if err := RestoreTrash([]string{root}, appData, "../../etc"); err == nil {
		t.Fatal("expected receipt id pattern rejection")
	}
}

func TestEmptyTrash_ReceiptIDPatternRejected(t *testing.T) {
	_, appData := setupTrash(t)
	if err := EmptyTrash(appData, []string{"../../etc"}); err == nil {
		t.Fatal("expected receipt id pattern rejection")
	}
	// Nothing should have been created under appData as a side effect.
	if _, err := os.Stat(filepath.Join(appData, "etc")); err == nil {
		t.Fatal("EmptyTrash created a path from an invalid id")
	}
}

// fabricateReceipt hand-builds a receipt directory + manifest.json outside
// of TrashItems, so a test can inject a malicious manifest field the same
// way a restored backup or a buggy consumer week might.
func fabricateReceipt(t *testing.T, appData string, items []TrashedItem) string {
	t.Helper()
	id := uuid.NewString()
	rDir := filepath.Join(appData, "trash", id)
	if err := os.MkdirAll(rDir, 0o700); err != nil {
		t.Fatal(err)
	}
	receipt := TrashReceipt{ID: id, TrashedAt: time.Now().UTC(), Items: items}
	data, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rDir, "manifest.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	return id
}

// TestRestoreTrash_MaliciousOrigPathRejected covers C1: a manifest whose
// OrigPath points outside every allowlisted root must be rejected, and the
// malicious destination must never be created.
func TestRestoreTrash_MaliciousOrigPathRejected(t *testing.T) {
	root, appData := setupTrash(t)
	evilDest := filepath.Join(t.TempDir(), "evil-should-not-exist")

	id := fabricateReceipt(t, appData, []TrashedItem{
		{OrigPath: evilDest, RelStore: "0/whatever.txt", Bytes: 1},
	})
	// Back the manifest entry with a real (harmless) file so a source-side
	// check alone wouldn't be the one rejecting this.
	mustWrite(t, filepath.Join(appData, "trash", id, "0", "whatever.txt"), "x")

	if err := RestoreTrash([]string{root}, appData, id); err == nil {
		t.Fatal("expected malicious OrigPath to be rejected")
	}
	mustNotExist(t, evilDest)
}

// TestRestoreTrash_MaliciousRelStoreRejected covers C2: a manifest whose
// RelStore escapes the receipt dir via ".." must be rejected.
func TestRestoreTrash_MaliciousRelStoreRejected(t *testing.T) {
	root, appData := setupTrash(t)
	legitDest := filepath.Join(root, "restored.txt")

	id := fabricateReceipt(t, appData, []TrashedItem{
		{OrigPath: legitDest, RelStore: "../../../../../../etc/passwd", Bytes: 1},
	})

	if err := RestoreTrash([]string{root}, appData, id); err == nil {
		t.Fatal("expected malicious RelStore to be rejected")
	}
	mustNotExist(t, legitDest)
}

// TestRestoreTrash_ConflictNoOverwrite covers L1: restoring onto an
// existing file must fail without overwriting it.
func TestRestoreTrash_ConflictNoOverwrite(t *testing.T) {
	root, appData := setupTrash(t)
	origPath := filepath.Join(root, "keep.txt")
	mustWrite(t, origPath, "will be trashed")

	roots := []string{root}
	receipt, err := TrashItems(roots, appData, []string{origPath})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}

	// Someone/something re-creates a file at the original path before restore.
	mustWrite(t, origPath, "conflicting content")

	if err := RestoreTrash(roots, appData, receipt.ID); err == nil {
		t.Fatal("expected a restore conflict")
	}

	got, err := os.ReadFile(origPath)
	if err != nil || string(got) != "conflicting content" {
		t.Fatalf("conflicting file was overwritten: %q err=%v", got, err)
	}
	// The trashed copy must still be sitting in the receipt, untouched.
	stored := filepath.Join(appData, "trash", receipt.ID, receipt.Items[0].RelStore)
	storedContent, err := os.ReadFile(stored)
	if err != nil || string(storedContent) != "will be trashed" {
		t.Fatalf("trashed copy missing/changed: %q err=%v", storedContent, err)
	}
}

// TestTrashItems_PermBits covers M2: receipt dir 0700, manifest.json 0600.
func TestTrashItems_PermBits(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: permission bits are not enforced")
	}
	root, appData := setupTrash(t)
	origPath := filepath.Join(root, "file.txt")
	mustWrite(t, origPath, "x")

	receipt, err := TrashItems([]string{root}, appData, []string{origPath})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}

	rDir := filepath.Join(appData, "trash", receipt.ID)
	info, err := os.Stat(rDir)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o700 {
		t.Fatalf("receipt dir perm = %o, want 0700", perm)
	}

	mInfo, err := os.Stat(filepath.Join(rDir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if perm := mInfo.Mode().Perm(); perm != 0o600 {
		t.Fatalf("manifest.json perm = %o, want 0600", perm)
	}
}

// TestEmptyTrash_FreesBytes covers exit criterion: ScanClaudeDir before/after
// must reflect freed bytes — no frozen numbers.
func TestEmptyTrash_FreesBytes(t *testing.T) {
	root, appData := setupTrash(t)
	origPath := filepath.Join(root, "big.bin")
	mustWrite(t, origPath, string(make([]byte, 5000)))

	receipt, err := TrashItems([]string{root}, appData, []string{origPath})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}

	before, err := ScanClaudeDir(context.Background(), []string{appData}, nil)
	if err != nil {
		t.Fatalf("scan before: %v", err)
	}
	var beforeBytes int64
	for _, u := range before {
		beforeBytes += u.Bytes
	}
	if beforeBytes == 0 {
		t.Fatal("expected non-zero bytes in app-data dir before emptying")
	}

	if err := EmptyTrash(appData, []string{receipt.ID}); err != nil {
		t.Fatalf("EmptyTrash: %v", err)
	}

	after, err := ScanClaudeDir(context.Background(), []string{appData}, nil)
	if err != nil {
		t.Fatalf("scan after: %v", err)
	}
	var afterBytes int64
	for _, u := range after {
		afterBytes += u.Bytes
	}
	if afterBytes >= beforeBytes {
		t.Fatalf("expected bytes to decrease after EmptyTrash: before=%d after=%d", beforeBytes, afterBytes)
	}

	list, err := ListTrash(appData)
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("expected emptied receipt to be gone, got %+v", list)
	}
}

// TestCopyRecursive_PreservesSymlinkAndMode directly exercises the
// EXDEV-fallback copy path's correctness (H2) without needing a real
// cross-device mount: a directory with an internal symlink and a 0600 file
// must come out the other side with both preserved.
func TestCopyRecursive_PreservesSymlinkAndMode(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: permission bits are not enforced")
	}
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "copy-dst")

	securePath := filepath.Join(src, "secret.jsonl")
	if err := os.WriteFile(securePath, []byte("session data"), 0o600); err != nil {
		t.Fatal(err)
	}
	linkTarget := filepath.Join(src, "secret.jsonl")
	link := filepath.Join(src, "alias")
	if err := os.Symlink(linkTarget, link); err != nil {
		t.Fatal(err)
	}

	if err := copyRecursive(src, dst); err != nil {
		t.Fatalf("copyRecursive: %v", err)
	}

	copiedFile := filepath.Join(dst, "secret.jsonl")
	info, err := os.Stat(copiedFile)
	if err != nil {
		t.Fatalf("stat copied file: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("copied file perm = %o, want 0600 (mode not preserved)", perm)
	}
	content, err := os.ReadFile(copiedFile)
	if err != nil || string(content) != "session data" {
		t.Fatalf("copied file content mismatch: %q err=%v", content, err)
	}

	copiedLink := filepath.Join(dst, "alias")
	lst, err := os.Lstat(copiedLink)
	if err != nil {
		t.Fatalf("lstat copied link: %v", err)
	}
	if lst.Mode()&os.ModeSymlink == 0 {
		t.Fatal("copied entry is not a symlink — was dereferenced during copy")
	}
	dest, err := os.Readlink(copiedLink)
	if err != nil || dest != linkTarget {
		t.Fatalf("copied symlink target mismatch: got %q err=%v", dest, err)
	}
}
