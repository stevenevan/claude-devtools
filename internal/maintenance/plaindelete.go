package maintenance

import (
	"fmt"
	"os"
)

// ClearFiles is the IRREVERSIBLE plain-delete counterpart to TrashItems: no
// trash copy, no receipt. Used only for regenerable diagnostics/caches where a
// trash copy would wrongly extend retention (logs, caches). It shares
// TrashItems' confinement discipline via validateLeaves (absolute, symlink-safe
// parent confine, root/appData/trash self-nuke refusal) and, like TrashItems,
// re-Lstats each leaf immediately before mutating it to close the validate→act
// TOCTOU window. A symlinked leaf is refused outright — never remove/truncate
// through a link. truncate=true zeroes the file in place (os.Truncate) so a
// daemon holding the fd keeps writing to the same inode; truncate=false removes.
func ClearFiles(roots []string, appDataDir string, paths []string, truncate bool) error {
	if len(paths) == 0 {
		return fmt.Errorf("maintenance: no paths given")
	}
	// Resolve appData first (creating it) so a roots entry pointing at a
	// not-yet-existing appData dir still canonicalizes.
	canonAppData, err := resolveAppDataDir(appDataDir, true)
	if err != nil {
		return err
	}
	canonRoots, err := canonicalizeRoots(roots)
	if err != nil {
		return err
	}

	leaves, err := validateLeaves(canonRoots, canonAppData, paths)
	if err != nil {
		return err
	}
	for _, leaf := range leaves {
		if leaf.isSymlink {
			return fmt.Errorf("maintenance: refusing to clear a symlink %q", leaf.origPath)
		}
	}

	for _, leaf := range leaves {
		// TOCTOU parity with trash.go's pre-move re-Lstat: refuse a leaf that
		// vanished or became a symlink between validation and the mutation.
		lst, err := os.Lstat(leaf.origPath)
		if err != nil {
			return fmt.Errorf("maintenance: %q vanished before clear: %w", leaf.origPath, err)
		}
		if lst.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("maintenance: %q became a symlink; refusing", leaf.origPath)
		}
		if truncate {
			if err := os.Truncate(leaf.origPath, 0); err != nil {
				return fmt.Errorf("maintenance: truncate %q: %w", leaf.origPath, err)
			}
			continue
		}
		if err := os.Remove(leaf.origPath); err != nil {
			return fmt.Errorf("maintenance: remove %q: %w", leaf.origPath, err)
		}
	}
	return nil
}
