package maintenance

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// matcher scans one leaf category and returns its cleanup candidates. Matchers
// register themselves via init() in their cat_*.go file so adding a category is
// purely additive — no central table to edit (and no per-week merge conflict on
// this file).
type matcher func(ctx context.Context, spec CategorySpec) ([]Candidate, error)

type registered struct {
	match matcher
	// defaultCutoffDays is the category's built-in age cutoff (0 = no age gate).
	// Lives here, beside the matcher, so each week's cat_*.go owns its default
	// and the service needs no per-category edit.
	defaultCutoffDays int
}

var matchers = map[string]registered{}

func registerMatcher(id string, defaultCutoffDays int, m matcher) {
	if _, dup := matchers[id]; dup {
		panic("maintenance: duplicate category matcher " + id)
	}
	matchers[id] = registered{match: m, defaultCutoffDays: defaultCutoffDays}
}

// CutoffDefault returns a category's built-in cutoff (days); 0 = no age gate.
func CutoffDefault(id string) int { return matchers[id].defaultCutoffDays }

// ScanCategory dispatches to the registered matcher for spec.ID. An unknown id
// is an error, not an empty result — the frontend only ever passes ids the
// service exposes, so an unknown id means a wiring bug.
func ScanCategory(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	r, ok := matchers[spec.ID]
	if !ok {
		return nil, fmt.Errorf("maintenance: unknown category %q", spec.ID)
	}
	return r.match(ctx, spec)
}

// ─── shared matcher helpers ──────────────────────────────────────────────────

// openDirNoSymlink Lstats dir and refuses to enumerate it if it is a symlink,
// mirroring scan.go's child-symlink-refused invariant: a symlinked category dir
// (e.g. a re-pointed transcripts/) must never let a matcher walk a subtree that
// lives outside the effective root. A missing dir yields (nil, nil) — the
// category simply has zero candidates.
func openDirNoSymlink(dir string) ([]os.DirEntry, bool, error) {
	info, err := os.Lstat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, false, nil // refuse to traverse a symlinked category root
	}
	if !info.IsDir() {
		return nil, false, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, false, err
	}
	return entries, true, nil
}

// subtreeStats aggregates a directory subtree the same way scan.go does: Lstat
// only, symlinks contribute zero bytes and are never traversed. Returns total
// bytes, file count, and the newest file/dir ModTime seen. The newest-mtime is
// what age-based matchers use for "last used" — a subtree whose newest entry is
// old is stale even if the top dir's own mtime was bumped by an unrelated op.
func subtreeStats(ctx context.Context, root string) (bytes int64, files int, newest time.Time, err error) {
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if walkErr != nil {
			return nil // skip unreadable entries, keep aggregating the rest
		}
		if d.Type()&fs.ModeSymlink != 0 {
			return nil // never follow; contributes 0 bytes like scan.go
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		if d.IsDir() {
			return nil
		}
		bytes += info.Size()
		files++
		return nil
	})
	return bytes, files, newest, walkErr
}

// isToday reports whether t falls on the same calendar day as now, in now's
// location. This is the W11 live-session guard: anything touched today is never
// a candidate, regardless of the age cutoff.
func isToday(t, now time.Time) bool {
	t = t.In(now.Location())
	ty, tm, td := t.Date()
	ny, nm, nd := now.Date()
	return ty == ny && tm == nm && td == nd
}

// olderThan is the age gate every age-based matcher shares: a candidate must be
// strictly older than the cutoff AND not modified today. A zero cutoff means no
// age gate (still excludes today) so non-age categories can pass time.Time{}.
func olderThan(mtime time.Time, spec CategorySpec) bool {
	if isToday(mtime, spec.Now) {
		return false
	}
	if spec.Cutoff.IsZero() {
		return true
	}
	return mtime.Before(spec.Cutoff)
}
