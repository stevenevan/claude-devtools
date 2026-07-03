package maintenance

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	// scanProgressInterval is how often (in directories visited) the internal
	// walk calls the caller's progress callback. The caller (maintenanceservice)
	// is responsible for further time-throttling before emitting events.
	scanProgressInterval = 64
	// maxScanDepth caps recursion into a pathologically deep tree. Real
	// ~/.claude trees never approach this.
	maxScanDepth = 64
)

// ScanClaudeDir returns one DirUsage row per immediate child of each root,
// with Bytes/Files aggregated recursively per child.
//
// Security invariants: sizes come from DirEntry.Info() (Lstat-backed) only —
// never os.Stat, never filepath.EvalSymlinks. An entry whose
// d.Type()&fs.ModeSymlink != 0 is flagged and never opened/read — this is
// what makes the walk symlink-cycle-safe. The root's own final path
// component IS followed (os.Stat, below) since we intentionally scan
// whatever the configured root points at; only child symlinks are refused.
func ScanClaudeDir(ctx context.Context, roots []string, progress func(dirs int, bytes int64)) ([]DirUsage, error) {
	out := []DirUsage{}
	dirsVisited := 0
	var bytesSoFar int64

	for _, root := range roots {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if err := validateRoot(root); err != nil {
			return out, err
		}

		entries, err := os.ReadDir(root)
		if err != nil {
			return out, fmt.Errorf("maintenance: read root %q: %w", root, err)
		}

		for _, entry := range entries {
			if err := ctx.Err(); err != nil {
				return out, err
			}
			childPath := filepath.Join(root, entry.Name())
			out = append(out, scanChild(ctx, childPath, entry, &dirsVisited, &bytesSoFar, progress))
		}
	}

	return out, nil
}

// validateRoot fails fast on a missing/non-directory root rather than
// launching a whole-FS walk on a corrupt config (e.g. pointing at "/").
func validateRoot(root string) error {
	info, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("maintenance: root %q: %w", root, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("maintenance: root %q is not a directory", root)
	}
	return nil
}

// scanChild classifies one immediate child of a root and, if it's a real
// directory, recursively aggregates its subtree.
func scanChild(ctx context.Context, childPath string, entry fs.DirEntry, dirsVisited *int, bytesSoFar *int64, progress func(int, int64)) DirUsage {
	info, err := entry.Info()
	if err != nil {
		return DirUsage{Path: childPath, Err: err.Error()}
	}

	if entry.Type()&fs.ModeSymlink != 0 {
		return DirUsage{Path: childPath, ModTime: info.ModTime(), IsSymlink: true}
	}

	if !entry.IsDir() {
		return DirUsage{Path: childPath, Bytes: info.Size(), Files: 1, ModTime: info.ModTime()}
	}

	return walkChildDir(ctx, childPath, info.ModTime(), dirsVisited, bytesSoFar, progress)
}

// walkChildDir recursively aggregates one child directory's subtree.
// Per-entry errors (e.g. permission-denied) are captured on the returned
// DirUsage.Err instead of aborting the walk. ctx is checked on every entry,
// not just at entry to this function.
func walkChildDir(ctx context.Context, childPath string, modTime time.Time, dirsVisited *int, bytesSoFar *int64, progress func(int, int64)) DirUsage {
	usage := DirUsage{Path: childPath, ModTime: modTime}

	walkErr := filepath.WalkDir(childPath, func(path string, d fs.DirEntry, err error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if err != nil {
			recordErr(&usage, err)
			return nil
		}
		if d.Type()&fs.ModeSymlink != 0 {
			return nil // flagged only at the immediate-child level; never traversed
		}
		if d.IsDir() {
			return visitDir(childPath, path, dirsVisited, bytesSoFar, progress)
		}
		return visitFile(d, &usage, bytesSoFar)
	})
	if walkErr != nil {
		recordErr(&usage, walkErr)
	}
	return usage
}

func recordErr(usage *DirUsage, err error) {
	if usage.Err == "" {
		usage.Err = err.Error()
	}
}

func visitDir(childPath, path string, dirsVisited *int, bytesSoFar *int64, progress func(int, int64)) error {
	rel, err := filepath.Rel(childPath, path)
	if err == nil && strings.Count(rel, string(filepath.Separator)) > maxScanDepth {
		return filepath.SkipDir
	}
	*dirsVisited++
	if progress != nil && *dirsVisited%scanProgressInterval == 0 {
		progress(*dirsVisited, *bytesSoFar)
	}
	return nil
}

func visitFile(d fs.DirEntry, usage *DirUsage, bytesSoFar *int64) error {
	info, err := d.Info()
	if err != nil {
		recordErr(usage, err)
		return nil
	}
	usage.Bytes += info.Size()
	usage.Files++
	*bytesSoFar += info.Size()
	return nil
}

const maxCategoryResults = 50

// ScanCategory runs a bounded scan for a single category matcher spec.
// Ships one trivial spec — top-level dirs by size, rooted at spec.ID; the
// real matcher framework lands in week 2+.
func ScanCategory(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	usages, err := ScanClaudeDir(ctx, []string{spec.ID}, nil)
	if err != nil {
		return nil, err
	}

	sort.Slice(usages, func(i, j int) bool { return usages[i].Bytes > usages[j].Bytes })
	if len(usages) > maxCategoryResults {
		usages = usages[:maxCategoryResults]
	}

	candidates := make([]Candidate, 0, len(usages))
	for _, u := range usages {
		candidates = append(candidates, Candidate{
			Path:   u.Path,
			Bytes:  u.Bytes,
			Reason: "top-level directory by size",
		})
	}
	return candidates, nil
}
