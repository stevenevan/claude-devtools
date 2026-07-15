package maintenance

import (
	"context"
	"io/fs"
	"path/filepath"
	"strings"
)

func init() {
	registerMatcher("junk-dsstore", 0, scanJunkDSStore)
	registerMatcher("junk-tmp", 1, scanJunkTmp)
	registerMatcher("junk-emptydirs", 0, scanJunkEmptyDirs)
}

// junkProtectedTopLevel are root-level dirs the CLI recreates and expects to
// find; the empty-dir matcher never recurses into or offers them, and treats
// them as real (non-collapsible) content for their parent — deleting them
// buys nothing and risks a CLI mkdir race.
var junkProtectedTopLevel = map[string]bool{"projects": true, "todos": true, "plugins": true}

// walkRootBounded walks spec.Root depth-bounded (mirrors scan.go's
// maxScanDepth), Lstat-only, and skips spec.AppData's subtree entirely — the
// app's own trash/manifests must never be swept as user junk. visit runs for
// every non-root entry (files and dirs); a symlinked entry is never passed to
// visit, matching this package's symlink-refusal invariant.
func walkRootBounded(ctx context.Context, spec CategorySpec, visit func(path string, d fs.DirEntry) error) error {
	root := spec.Root
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if err != nil {
			return nil // skip unreadable entries, keep walking the rest
		}
		if path == root {
			return nil
		}
		if spec.AppData != "" && filepath.Clean(path) == filepath.Clean(spec.AppData) {
			return fs.SkipDir // never sweep the app's own data dir
		}
		if d.Type()&fs.ModeSymlink != 0 {
			return nil // never traverse; WalkDir won't recurse into it either way
		}
		if d.IsDir() {
			rel, relErr := filepath.Rel(root, path)
			if relErr == nil && strings.Count(rel, string(filepath.Separator)) > maxScanDepth {
				return fs.SkipDir
			}
		}
		return visit(path, d)
	})
}

// scanJunkDSStore flags every macOS .DS_Store file anywhere under the
// effective root. No age gate — a .DS_Store is worthless the moment it's
// written.
func scanJunkDSStore(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	out := []Candidate{}
	err := walkRootBounded(ctx, spec, func(path string, d fs.DirEntry) error {
		if d.IsDir() || d.Name() != ".DS_Store" {
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil {
			return nil
		}
		out = append(out, Candidate{
			Path: path, Bytes: info.Size(), Files: 1, ModTime: info.ModTime(),
			Reason: "macOS metadata file",
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// scanJunkTmp flags *.tmp files older than the cutoff (default 1 day) — the
// age floor guards against sweeping a temp+rename write still in progress.
func scanJunkTmp(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	out := []Candidate{}
	err := walkRootBounded(ctx, spec, func(path string, d fs.DirEntry) error {
		if d.IsDir() || filepath.Ext(d.Name()) != ".tmp" {
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil {
			return nil
		}
		if !olderThan(info.ModTime(), spec) {
			return nil
		}
		out = append(out, Candidate{
			Path: path, Bytes: info.Size(), Files: 1, ModTime: info.ModTime(),
			Reason: "stale temp file",
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// scanJunkEmptyDirs reports the TOPMOST fully-empty ancestor of every empty
// subtree as ONE candidate — required so a batch never asks the trash engine
// to move both a dir and something nested inside it. "Empty" means: contains
// nothing, or only a .DS_Store file and/or recursively-empty subdirs.
func scanJunkEmptyDirs(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	out := []Candidate{}
	if _, err := emptyDirScan(ctx, spec, spec.Root, 0, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// emptyDirScan is a bottom-up (post-order) walk that can't be expressed as a
// simple top-down visit callback like walkRootBounded: whether a dir gets
// reported depends on what its subdirs decide, which is only known after
// recursing into them. It mirrors the same invariants (Lstat-only/no symlink
// traversal, AppData excluded, depth-bounded, ctx.Err() checked) by hand.
//
// Returns whether dir itself is empty. When dir is NOT empty (real content,
// depth limit, or protected), any of its direct subdir children that WERE
// empty are finalized as candidates here — dir is the collapse boundary for
// that branch. When dir IS empty, nothing is finalized yet; the decision is
// deferred to whichever ancestor turns out non-empty (or the root, which is
// always non-collapsible and never itself reported).
func emptyDirScan(ctx context.Context, spec CategorySpec, dir string, depth int, out *[]Candidate) (bool, error) {
	entries, ok, err := openDirNoSymlink(dir)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil // missing/symlink/non-dir — never empty, never a candidate
	}

	empty := true
	pendingEmpty := []string{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		childPath := filepath.Join(dir, e.Name())

		if e.Type()&fs.ModeSymlink != 0 {
			empty = false // never traverse/collapse through a symlink
			continue
		}
		if !e.IsDir() {
			if e.Name() != ".DS_Store" {
				empty = false
			}
			continue
		}
		if isProtectedJunkDir(spec, dir, childPath) || depth >= maxScanDepth {
			empty = false // opaque/depth-capped: treat as real, non-collapsible content
			continue
		}

		childEmpty, childErr := emptyDirScan(ctx, spec, childPath, depth+1, out)
		if childErr != nil {
			return false, childErr
		}
		if childEmpty {
			pendingEmpty = append(pendingEmpty, childPath)
		} else {
			empty = false
		}
	}

	if empty {
		return true, nil // let the parent decide whether to collapse further
	}
	for _, p := range pendingEmpty {
		bytes, files, newest, statErr := subtreeStats(ctx, p)
		if statErr != nil {
			return false, statErr
		}
		*out = append(*out, Candidate{
			Path: p, Bytes: bytes, Files: files, ModTime: newest,
			Reason: "empty directory",
		})
	}
	return false, nil
}

// isProtectedJunkDir reports whether childPath must never be recursed into,
// collapsed, or offered: the app's own data dir, or one of the root-level
// dirs the CLI recreates and expects.
func isProtectedJunkDir(spec CategorySpec, parent, childPath string) bool {
	if spec.AppData != "" && filepath.Clean(childPath) == filepath.Clean(spec.AppData) {
		return true
	}
	if parent == spec.Root && junkProtectedTopLevel[filepath.Base(childPath)] {
		return true
	}
	return false
}
