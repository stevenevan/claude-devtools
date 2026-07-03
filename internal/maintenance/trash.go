// Package maintenance — trash.go implements the safe-delete/trash engine:
// the ONE destructive primitive every later cleanup feature routes through.
// A confinement or symlink-safety bug here is a data-loss bug in every
// consumer — each check below closes a specific CRITICAL/HIGH finding from
// the week-2 security review (see docs/wails-migration plan): C1/C2
// (restore confinement), H1 (root canonicalization), H2 (EXDEV copy
// ordering), M1/M2 (refuse + perms), L1/L3/L5 (conflict check, TOCTOU,
// receipt-id validation).
package maintenance

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"

	"claude-devtools/internal/discovery"
	"claude-devtools/internal/files"
)

// TrashedItem is one moved entry inside a TrashReceipt's manifest.
type TrashedItem struct {
	OrigPath string `json:"origPath"`
	RelStore string `json:"relStore"`
	Bytes    int64  `json:"bytes"`
}

// TrashReceipt is the record of one TrashItems batch, persisted as
// manifest.json inside its own receipt directory.
type TrashReceipt struct {
	ID        string        `json:"id"`
	TrashedAt time.Time     `json:"trashedAt"`
	Items     []TrashedItem `json:"items"`
}

// ─── TrashItems ──────────────────────────────────────────────────────────────

// trashItemPlan is the validated, pre-move description of one input path.
// origPath is already canonical (parentCanon/base) — this is what gets
// stored as TrashedItem.OrigPath so restore's lexical re-confine matches it.
type trashItemPlan struct {
	origPath  string
	isSymlink bool
	relStore  string
}

// TrashItems moves paths into <appDataDir>/trash/<receiptID>/, validating
// every path against roots BEFORE moving any of them (invariant #1: nothing
// moves if any input is invalid). roots and appDataDir are canonicalized via
// EvalSymlinks once per call (invariant #0) since ~/.claude or $HOME may
// itself be a symlink.
func TrashItems(roots []string, appDataDir string, paths []string) (TrashReceipt, error) {
	if len(paths) == 0 {
		return TrashReceipt{}, fmt.Errorf("maintenance: no paths given")
	}

	canonRoots, err := canonicalizeRoots(roots)
	if err != nil {
		return TrashReceipt{}, err
	}
	canonAppData, err := resolveAppDataDir(appDataDir, true)
	if err != nil {
		return TrashReceipt{}, err
	}

	plans, err := planTrashItems(canonRoots, canonAppData, paths)
	if err != nil {
		return TrashReceipt{}, err
	}

	receiptID := uuid.NewString()
	rDir := filepath.Join(canonAppData, "trash", receiptID)
	// M2: receipt root is 0700 — it holds copies of conversation/config files.
	if err := os.MkdirAll(rDir, 0o700); err != nil {
		return TrashReceipt{}, fmt.Errorf("maintenance: create receipt dir: %w", err)
	}

	receipt := TrashReceipt{ID: receiptID, TrashedAt: time.Now().UTC(), Items: []TrashedItem{}}

	for _, p := range plans {
		destPath := filepath.Join(rDir, p.relStore)
		if err := os.MkdirAll(filepath.Dir(destPath), 0o700); err != nil {
			return receipt, fmt.Errorf("maintenance: mkdir trash destination: %w", err)
		}

		// L3: re-Lstat immediately before the move to narrow the parent-swap
		// TOCTOU window between planning and the actual rename.
		if _, err := os.Lstat(p.origPath); err != nil {
			return receipt, fmt.Errorf("maintenance: %q vanished before move: %w", p.origPath, err)
		}

		size, err := pathBytes(p.origPath)
		if err != nil {
			return receipt, fmt.Errorf("maintenance: measure %q: %w", p.origPath, err)
		}

		if err := moveItem(p.origPath, destPath); err != nil {
			return receipt, fmt.Errorf("maintenance: move %q: %w", p.origPath, err)
		}

		// MUST-2: append after this item physically moves, not once at batch
		// end — a crash mid-batch must never leave a moved file with no
		// manifest entry.
		receipt.Items = append(receipt.Items, TrashedItem{
			OrigPath: p.origPath,
			RelStore: p.relStore,
			Bytes:    size,
		})
		if err := writeManifest(rDir, receipt); err != nil {
			return receipt, fmt.Errorf("maintenance: write manifest: %w", err)
		}
	}

	return receipt, nil
}

// planTrashItems validates every input path before TrashItems moves any of
// them: confinement (#1), symlink-safe parent resolution (#2), and the
// refuse/dedupe/no-nest rules (M1, MUST-2).
func planTrashItems(canonRoots []string, canonAppData string, paths []string) ([]trashItemPlan, error) {
	trashDir := filepath.Join(canonAppData, "trash")
	seen := make(map[string]bool, len(paths))
	plans := make([]trashItemPlan, 0, len(paths))

	for _, raw := range paths {
		cleaned := filepath.Clean(raw)
		if !filepath.IsAbs(cleaned) {
			return nil, fmt.Errorf("maintenance: path %q must be absolute", raw)
		}

		// #2 SEC-symlink: never Confine() the leaf itself (it would resolve
		// through a symlink to its target). Confine only the parent, then
		// Lstat the leaf and move the link entry, never its target.
		parentCanon, err := confineParentToRoot(filepath.Dir(cleaned), canonRoots)
		if err != nil {
			return nil, fmt.Errorf("maintenance: %q: %w", raw, err)
		}

		base := filepath.Base(cleaned)
		leafPath := filepath.Join(parentCanon, base)

		lst, err := os.Lstat(leafPath)
		if err != nil {
			return nil, fmt.Errorf("maintenance: %q: %w", raw, err)
		}

		// M1: refuse root / appdata / trash-tree self-nuke.
		if leafPath == canonAppData || isSameOrWithin(leafPath, trashDir) {
			return nil, fmt.Errorf("maintenance: %q: refusing to trash the app-data/trash tree", raw)
		}
		for _, r := range canonRoots {
			if leafPath == r {
				return nil, fmt.Errorf("maintenance: %q: refusing to trash a claude-root directory", raw)
			}
		}

		if seen[leafPath] {
			continue // dedupe inputs identical after canonicalization
		}
		seen[leafPath] = true

		rootIndex, relToRoot, err := relativeToOneOf(leafPath, canonRoots)
		if err != nil {
			return nil, fmt.Errorf("maintenance: %q: %w", raw, err)
		}

		plans = append(plans, trashItemPlan{
			origPath:  leafPath,
			isSymlink: lst.Mode()&os.ModeSymlink != 0,
			// MUST-3: root discriminator prefix — same-basename items from
			// different roots must never collide under one receipt.
			relStore: filepath.Join(fmt.Sprintf("%d", rootIndex), relToRoot),
		})
	}

	if err := rejectNestedInputs(plans); err != nil {
		return nil, err
	}
	return plans, nil
}

// confineParentToRoot resolves parent (which must exist) and confirms it
// falls within one of canonRoots, reusing files.Confine per-root.
func confineParentToRoot(parent string, canonRoots []string) (string, error) {
	canon, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", fmt.Errorf("parent %q does not resolve: %w", parent, err)
	}
	for _, root := range canonRoots {
		if _, err := files.Confine(canon, root); err == nil {
			return canon, nil
		}
	}
	return "", fmt.Errorf("%s", files.ErrEscapesRoot)
}

// relativeToOneOf returns the index of the first canonRoots entry that
// contains path, plus path's slash-relative position under it.
func relativeToOneOf(path string, canonRoots []string) (int, string, error) {
	for i, root := range canonRoots {
		rel, err := filepath.Rel(root, path)
		if err != nil {
			continue
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		return i, rel, nil
	}
	return -1, "", fmt.Errorf("%s", files.ErrEscapesRoot)
}

// rejectNestedInputs refuses a batch where one input is an ancestor
// directory of another (MUST-2's no-nest rule).
func rejectNestedInputs(plans []trashItemPlan) error {
	for i, a := range plans {
		for j, b := range plans {
			if i == j {
				continue
			}
			if isStrictlyWithin(b.origPath, a.origPath) {
				return fmt.Errorf("maintenance: input paths must not nest (%q contains %q)", a.origPath, b.origPath)
			}
		}
	}
	return nil
}

func isStrictlyWithin(path, dir string) bool {
	if path == dir {
		return false
	}
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func isSameOrWithin(path, dir string) bool {
	return path == dir || isStrictlyWithin(path, dir)
}

// ─── ListTrash ───────────────────────────────────────────────────────────────

// ListTrash reads every receipt's manifest.json under <appDataDir>/trash.
// A missing app-data dir simply means nothing has ever been trashed.
func ListTrash(appDataDir string) ([]TrashReceipt, error) {
	if _, err := os.Stat(appDataDir); os.IsNotExist(err) {
		return []TrashReceipt{}, nil
	}
	canonAppData, err := resolveAppDataDir(appDataDir, false)
	if err != nil {
		return nil, err
	}

	trashDir := filepath.Join(canonAppData, "trash")
	entries, err := os.ReadDir(trashDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []TrashReceipt{}, nil
		}
		return nil, fmt.Errorf("maintenance: read trash dir: %w", err)
	}

	receipts := make([]TrashReceipt, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		receipt, err := readManifest(filepath.Join(trashDir, e.Name()))
		if err != nil {
			continue // no/corrupt manifest (e.g. crash before first item wrote it) — skip, not fatal
		}
		receipts = append(receipts, receipt)
	}
	sort.Slice(receipts, func(i, j int) bool { return receipts[i].TrashedAt.After(receipts[j].TrashedAt) })
	return receipts, nil
}

// ─── RestoreTrash ────────────────────────────────────────────────────────────

// RestoreTrash moves every item in receiptID back to its OrigPath.
//
// Confine() cannot protect the destination side (invariant #3/C1): it
// returns a non-existent candidate UNCHANGED with zero containment check,
// and the restore destination normally does not exist — so Confine(OrigPath)
// would be a silent no-op. Manifests are attacker-influenceable (backup
// restore, sync, a future buggy consumer week), so OrigPath gets a lexical
// confine plus a nearest-existing-ancestor EvalSymlinks confine instead
// (confineRestoreDest). RelStore is validated lexically and then via
// Confine within the receipt dir, where it actually exists (confineRestoreSource).
func RestoreTrash(roots []string, appDataDir, receiptID string) error {
	if !discovery.IsValidSessionID(receiptID) {
		return fmt.Errorf("maintenance: invalid receipt id")
	}

	canonRoots, err := canonicalizeRoots(roots)
	if err != nil {
		return err
	}
	canonAppData, err := resolveAppDataDir(appDataDir, false)
	if err != nil {
		return err
	}

	rDir := filepath.Join(canonAppData, "trash", receiptID)
	receipt, err := readManifest(rDir)
	if err != nil {
		return fmt.Errorf("maintenance: receipt %q: %w", receiptID, err)
	}

	type restoreStep struct{ src, dest string }
	steps := make([]restoreStep, 0, len(receipt.Items))

	// Validate every item BEFORE moving any of them (invariant #1).
	for _, item := range receipt.Items {
		src, err := confineRestoreSource(item.RelStore, rDir)
		if err != nil {
			return fmt.Errorf("maintenance: item %q: %w", item.OrigPath, err)
		}
		dest, err := confineRestoreDest(item.OrigPath, canonRoots)
		if err != nil {
			return fmt.Errorf("maintenance: item %q: %w", item.OrigPath, err)
		}
		// L1: os.Lstat (not Stat) so a dangling symlink still counts as a conflict.
		if _, err := os.Lstat(dest); err == nil {
			return fmt.Errorf("maintenance: restore conflict: %q already exists", dest)
		}
		steps = append(steps, restoreStep{src: src, dest: dest})
	}

	for _, s := range steps {
		// M2/CONSIDER-D: create the missing tail at 0700, only below an
		// already-confined ancestor (confineRestoreDest verified this above).
		if err := os.MkdirAll(filepath.Dir(s.dest), 0o700); err != nil {
			return fmt.Errorf("maintenance: create restore parent for %q: %w", s.dest, err)
		}
		if err := moveItem(s.src, s.dest); err != nil {
			return fmt.Errorf("maintenance: restore %q: %w", s.dest, err)
		}
	}

	// Every item moved out — the receipt dir is now empty; drop it so
	// ListTrash doesn't keep reporting a receipt whose contents are gone.
	return os.RemoveAll(rDir)
}

// confineRestoreSource validates RelStore lexically (reject absolute, reject
// any ".." segment) and then confines the resolved candidate within
// receiptDir, where it actually exists (C2).
func confineRestoreSource(relStore, receiptDir string) (string, error) {
	cleaned := filepath.Clean(relStore)
	if filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("%s", files.ErrEscapesRoot)
	}
	for _, seg := range strings.Split(cleaned, string(filepath.Separator)) {
		if seg == ".." {
			return "", fmt.Errorf("%s", files.ErrEscapesRoot)
		}
	}

	candidate := filepath.Join(receiptDir, cleaned)
	if _, err := files.Confine(candidate, receiptDir); err != nil {
		return "", err
	}
	return candidate, nil
}

// confineRestoreDest validates OrigPath without ever stat-ing the full
// candidate (C1): Clean + IsAbs + Rel-against-root lexical check, then
// EvalSymlinks + Confine only the nearest EXISTING ancestor — a swapped
// symlinked ancestor (e.g. a re-pointed "projects/" dir) must not redirect
// the eventual write.
func confineRestoreDest(origPath string, canonRoots []string) (string, error) {
	cleaned := filepath.Clean(origPath)
	if !filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("maintenance: manifest origPath %q must be absolute", origPath)
	}

	rootIndex := -1
	for i, root := range canonRoots {
		rel, err := filepath.Rel(root, cleaned)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		rootIndex = i
		break
	}
	if rootIndex < 0 {
		return "", fmt.Errorf("%s", files.ErrEscapesRoot)
	}

	// The missing tail doesn't exist yet (created below via MkdirAll 0700),
	// so there's nothing to resolve there; only an already-existing ancestor
	// could be a symlink redirecting the write.
	ancestor := filepath.Dir(cleaned)
	for {
		if _, err := os.Lstat(ancestor); err == nil {
			break
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			return "", fmt.Errorf("maintenance: no existing ancestor for %q", origPath)
		}
		ancestor = parent
	}
	if _, err := files.Confine(ancestor, canonRoots[rootIndex]); err != nil {
		return "", err
	}

	return cleaned, nil
}

// ─── EmptyTrash ──────────────────────────────────────────────────────────────

// EmptyTrash permanently deletes the given receipts. Every id is validated
// before any deletion (MUST-1: fail-closed, abort the whole batch on any
// invalid id).
func EmptyTrash(appDataDir string, receiptIDs []string) error {
	for _, id := range receiptIDs {
		if !discovery.IsValidSessionID(id) {
			return fmt.Errorf("maintenance: invalid receipt id %q", id)
		}
	}

	canonAppData, err := resolveAppDataDir(appDataDir, false)
	if err != nil {
		return err
	}
	trashDir := filepath.Join(canonAppData, "trash")

	for _, id := range receiptIDs {
		if err := os.RemoveAll(filepath.Join(trashDir, id)); err != nil {
			return fmt.Errorf("maintenance: empty receipt %q: %w", id, err)
		}
	}
	return nil
}

// ─── shared helpers ──────────────────────────────────────────────────────────

// canonicalizeRoots EvalSymlinks every root once (#0/H1) — Confine's Rel
// math is only correct against an already-resolved root, and `~/.claude` or
// $HOME may itself be a symlink. Fail-closed if a root won't resolve.
func canonicalizeRoots(roots []string) ([]string, error) {
	canon := make([]string, len(roots))
	for i, r := range roots {
		c, err := filepath.EvalSymlinks(r)
		if err != nil {
			return nil, fmt.Errorf("maintenance: root %q does not resolve: %w", r, err)
		}
		canon[i] = c
	}
	return canon, nil
}

// resolveAppDataDir optionally creates appDataDir (general-purpose 0755 —
// it also holds config/snapshots/cache, not just trash) then canonicalizes it.
func resolveAppDataDir(appDataDir string, create bool) (string, error) {
	if create {
		if err := os.MkdirAll(appDataDir, 0o755); err != nil {
			return "", fmt.Errorf("maintenance: create app-data dir: %w", err)
		}
	}
	canon, err := filepath.EvalSymlinks(appDataDir)
	if err != nil {
		return "", fmt.Errorf("maintenance: app-data dir %q does not resolve: %w", appDataDir, err)
	}
	return canon, nil
}

func readManifest(receiptDir string) (TrashReceipt, error) {
	data, err := os.ReadFile(filepath.Join(receiptDir, "manifest.json"))
	if err != nil {
		return TrashReceipt{}, fmt.Errorf("read manifest: %w", err)
	}
	var r TrashReceipt
	if err := json.Unmarshal(data, &r); err != nil {
		return TrashReceipt{}, fmt.Errorf("parse manifest: %w", err)
	}
	return r, nil
}

// writeManifest overwrites manifest.json atomically (temp file + rename),
// mode 0600 (M2) since it lists conversation/project paths.
func writeManifest(receiptDir string, receipt TrashReceipt) error {
	data, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	manifestFile := filepath.Join(receiptDir, "manifest.json")
	tmp := manifestFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write manifest.tmp: %w", err)
	}
	if err := os.Rename(tmp, manifestFile); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename manifest.tmp: %w", err)
	}
	return nil
}

// moveItem renames src to dst, falling back to copy-verify-then-delete on
// EXDEV (#4/H2). On copy failure the partial copy is removed and src is left
// 100% intact.
func moveItem(src, dst string) error {
	err := os.Rename(src, dst)
	if err == nil {
		return nil
	}
	if !errors.Is(err, syscall.EXDEV) {
		return err
	}

	if err := copyRecursive(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return err
	}
	if _, err := os.Lstat(dst); err != nil {
		_ = os.RemoveAll(dst)
		return fmt.Errorf("copy verification failed: %w", err)
	}
	return os.RemoveAll(src)
}

// copyRecursive Lstats every entry and recreates symlinks with os.Symlink —
// never io.Copy through them — and preserves each entry's mode via
// os.Chmod (a 0600 session JSONL must not become 0644).
func copyRecursive(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}

	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(src)
		if err != nil {
			return err
		}
		return os.Symlink(target, dst)
	}

	if info.IsDir() {
		if err := os.MkdirAll(dst, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, e := range entries {
			if err := copyRecursive(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
				return err
			}
		}
		return os.Chmod(dst, info.Mode().Perm())
	}

	return copyFile(src, dst, info.Mode().Perm())
}

func copyFile(src, dst string, mode os.FileMode) error {
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
	if err := out.Close(); err != nil {
		return err
	}
	return os.Chmod(dst, mode) // OpenFile's mode is subject to umask; force-preserve exactly.
}

// pathBytes measures a fresh byte count for path (file or directory
// subtree) via Lstat/WalkDir only, matching ScanClaudeDir's rule of never
// following symlinks — a symlink itself contributes 0 bytes, same as a
// symlink child in DirUsage.
func pathBytes(path string) (int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return 0, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return 0, nil
	}
	if !info.IsDir() {
		return info.Size(), nil
	}

	var total int64
	err = filepath.WalkDir(path, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&fs.ModeSymlink != 0 || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		return nil
	})
	return total, err
}
