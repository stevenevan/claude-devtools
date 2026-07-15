package maintenance

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// RollbackBinary replaces the active binary at activePath with backupPath's
// contents, atomically, after first trashing a copy of the CURRENT active so
// the rollback is itself reversible. Contents only — it never edits
// settings.json. The status-line/hook binaries execute on every prompt, so the
// safety here mirrors trash.go: both paths are parent-confined to a root, a
// symlinked/missing leaf is refused, the restored file keeps the active file's
// mode (with owner-exec forced so a mode-stripped .bak can't brick the CLI),
// and the write is temp+fsync+rename so a crash can't leave a zero-length
// executable. The live active is never moved before the atomic rename.
func RollbackBinary(roots []string, appDataDir, activePath, backupPath string) (TrashReceipt, error) {
	// Resolve appData first (creating it) so a roots entry pointing at a
	// not-yet-existing appData dir still canonicalizes.
	canonAppData, err := resolveAppDataDir(appDataDir, true)
	if err != nil {
		return TrashReceipt{}, err
	}
	canonRoots, err := canonicalizeRoots(roots)
	if err != nil {
		return TrashReceipt{}, err
	}

	activeParent, activeBase, err := confineLeafForReplace(activePath, canonRoots)
	if err != nil {
		return TrashReceipt{}, fmt.Errorf("maintenance: active %q: %w", activePath, err)
	}
	backupParent, backupBase, err := confineLeafForReplace(backupPath, canonRoots)
	if err != nil {
		return TrashReceipt{}, fmt.Errorf("maintenance: backup %q: %w", backupPath, err)
	}
	activeFull := filepath.Join(activeParent, activeBase)
	backupFull := filepath.Join(backupParent, backupBase)

	activeInfo, err := os.Lstat(activeFull)
	if err != nil {
		return TrashReceipt{}, fmt.Errorf("maintenance: active %q: %w", activePath, err)
	}
	mode := activeInfo.Mode().Perm() | 0o100 // force owner-exec (a .bak may have lost +x)

	// 1) Preserve the current active: copy its bytes to a throwaway under
	//    appData and trash THAT (never move the live binary). roots includes
	//    appData so the tmp copy's parent confines.
	tmpDir := filepath.Join(canonAppData, "rollback-tmp")
	if err := os.MkdirAll(tmpDir, 0o700); err != nil {
		return TrashReceipt{}, err
	}
	tmpCopy := filepath.Join(tmpDir, "active-"+uuid.NewString())
	if err := copyFile(activeFull, tmpCopy, mode); err != nil {
		return TrashReceipt{}, fmt.Errorf("maintenance: preserve active: %w", err)
	}
	receipt, err := TrashItems(roots, appDataDir, []string{tmpCopy})
	if err != nil {
		_ = os.Remove(tmpCopy)
		return TrashReceipt{}, fmt.Errorf("maintenance: preserve active: %w", err)
	}

	// 2) Atomically replace the active binary with the backup's contents.
	tmpNew := activeFull + ".rollback.tmp"
	if err := copyFileFsync(backupFull, tmpNew, mode); err != nil {
		_ = os.Remove(tmpNew)
		return receipt, fmt.Errorf("maintenance: write new active: %w", err)
	}
	if _, err := os.Lstat(activeFull); err != nil { // re-check immediately before rename
		_ = os.Remove(tmpNew)
		return receipt, fmt.Errorf("maintenance: active vanished before rollback: %w", err)
	}
	if err := os.Rename(tmpNew, activeFull); err != nil {
		_ = os.Remove(tmpNew)
		return receipt, fmt.Errorf("maintenance: rename new active: %w", err)
	}
	syncDir(activeParent)
	return receipt, nil
}

// confineLeafForReplace parent-confines path (EvalSymlinks the parent, confine
// the parent, Lstat the leaf) and refuses a symlinked or missing leaf — never
// EvalSymlinks the leaf itself (that would resolve through a planted symlink to
// a target outside the root). Returns the canonical parent + base.
func confineLeafForReplace(path string, canonRoots []string) (parent, base string, err error) {
	cleaned := filepath.Clean(path)
	if !filepath.IsAbs(cleaned) {
		return "", "", fmt.Errorf("path must be absolute")
	}
	parentCanon, err := confineParentToRoot(filepath.Dir(cleaned), canonRoots)
	if err != nil {
		return "", "", err
	}
	base = filepath.Base(cleaned)
	lst, err := os.Lstat(filepath.Join(parentCanon, base))
	if err != nil {
		return "", "", err
	}
	if lst.Mode()&os.ModeSymlink != 0 {
		return "", "", fmt.Errorf("refusing to operate on a symlink")
	}
	return parentCanon, base, nil
}

// copyFileFsync copies src→dst preserving mode, fsyncing the file before close
// so a crash can't leave a partial/zero-length executable.
func copyFileFsync(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Chmod(dst, mode)
}

// syncDir fsyncs a directory so a rename is durable (best-effort).
func syncDir(dir string) {
	d, err := os.Open(dir)
	if err != nil {
		return
	}
	_ = d.Sync()
	_ = d.Close()
}
