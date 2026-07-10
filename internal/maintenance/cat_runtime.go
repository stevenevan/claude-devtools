package maintenance

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

func init() {
	registerMatcher("runtime-tasks", 7, scanRuntimeTasks)
	registerMatcher("runtime-tasks-empty", 2, scanRuntimeTasksEmpty)
	registerMatcher("runtime-jobs", 7, scanRuntimeJobs)
	registerMatcher("runtime-sessions", 7, scanRuntimeSessions)
	registerMatcher("runtime-session-env", 7, scanRuntimeSessionEnv)
	registerMatcher("runtime-shell-snapshots", 7, scanRuntimeShellSnapshots)
}

// runtimeEntryFilter decides whether one subdir entry belongs to a given
// runtime family, independent of its age. markerOnly is only meaningful for
// dir entries (see isMarkerOnlyDir); it's always false for files.
type runtimeEntryFilter func(isDir, markerOnly bool) bool

// scanRuntimeSubdir is the shared per-entry age-gate scanner behind all six
// W11 runtime-state families: every family is "each entry directly under
// <root>/<subdir>, older than the cutoff, optionally excluding one protected
// name and/or narrowed by a marker-only predicate (tasks/tasks-empty split)."
// A dir entry's age is its newest descendant (subtreeStats); a file entry's
// age is its own mtime. Today's mtime is never a candidate (olderThan).
func scanRuntimeSubdir(ctx context.Context, spec CategorySpec, subdir, reason, protectedName string, filter runtimeEntryFilter) ([]Candidate, error) {
	dir := filepath.Join(spec.Root, subdir)
	entries, ok, err := openDirNoSymlink(dir)
	if err != nil || !ok {
		return []Candidate{}, err
	}

	out := []Candidate{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if protectedName != "" && e.Name() == protectedName {
			continue
		}
		path := filepath.Join(dir, e.Name())

		var bytes int64
		var files int
		var mtime time.Time
		markerOnly := false
		if e.IsDir() {
			bytes, files, mtime, err = subtreeStats(ctx, path)
			if err != nil {
				return nil, err
			}
			markerOnly, err = isMarkerOnlyDir(ctx, path)
			if err != nil {
				return nil, err
			}
		} else {
			info, infoErr := e.Info()
			if infoErr != nil || info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			bytes = info.Size()
			files = 1
			mtime = info.ModTime()
		}

		if filter != nil && !filter(e.IsDir(), markerOnly) {
			continue
		}
		if !olderThan(mtime, spec) {
			continue
		}
		out = append(out, Candidate{Path: path, Bytes: bytes, Files: files, ModTime: mtime, Reason: reason})
	}
	return out, nil
}

// isMarkerOnlyDir reports whether dir's subtree contains only the CLI's own
// ".lock"/".highwatermark" bookkeeping files (or nothing at all). This is the
// runtime-tasks vs runtime-tasks-empty split: a dir with any other file holds
// real (if dead) task state, while marker-only means nothing but the lock/
// highwatermark markers remain.
func isMarkerOnlyDir(ctx context.Context, dir string) (bool, error) {
	markerOnly := true
	walkErr := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if err != nil {
			return nil
		}
		if d.IsDir() || d.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		if name := d.Name(); name != ".lock" && name != ".highwatermark" {
			markerOnly = false
		}
		return nil
	})
	return markerOnly, walkErr
}

// scanRuntimeTasks flags per-UUID dirs under tasks/ holding real (dead) task
// state — marker-only dirs are excluded here and belong to
// runtime-tasks-empty instead.
func scanRuntimeTasks(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	return scanRuntimeSubdir(ctx, spec, "tasks", "dead task state", "", func(isDir, markerOnly bool) bool {
		return isDir && !markerOnly
	})
}

// scanRuntimeTasksEmpty flags per-UUID dirs under tasks/ that are marker-only
// (or truly empty) — nothing left but .lock/.highwatermark bookkeeping, so a
// tighter 2-day cutoff applies.
func scanRuntimeTasksEmpty(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	return scanRuntimeSubdir(ctx, spec, "tasks", "empty task markers", "", func(isDir, markerOnly bool) bool {
		return isDir && markerOnly
	})
}

// scanRuntimeJobs flags stale entries under jobs/, except pins.json — user
// pin state, not a runtime dropping.
func scanRuntimeJobs(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	return scanRuntimeSubdir(ctx, spec, "jobs", "old job", "pins.json", nil)
}

// scanRuntimeSessions flags stale per-file entries under sessions/.
func scanRuntimeSessions(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	return scanRuntimeSubdir(ctx, spec, "sessions", "stale session state", "", nil)
}

// scanRuntimeSessionEnv flags stale per-file entries under session-env/.
func scanRuntimeSessionEnv(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	return scanRuntimeSubdir(ctx, spec, "session-env", "stale session environment", "", nil)
}

// scanRuntimeShellSnapshots flags stale per-file entries under
// shell-snapshots/.
func scanRuntimeShellSnapshots(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	return scanRuntimeSubdir(ctx, spec, "shell-snapshots", "stale shell snapshot", "", nil)
}
