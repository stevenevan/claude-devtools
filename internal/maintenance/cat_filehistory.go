package maintenance

import (
	"context"
	"path/filepath"
)

func init() { registerMatcher("file-history", 30, scanFileHistory) }

// scanFileHistory surfaces reclaimable storage under <root>/file-history — the
// CLI's per-file edit-undo snapshot store, one UUID dir per tracked file with
// no built-in retention. Candidates are split into two groups:
//   - "empty": a UUID dir holding zero snapshot files (dead weight, no undo
//     value at all).
//   - "stale": a UUID dir whose newest snapshot has aged past the cutoff
//     (default 30d) — undo history that old is unlikely to ever be restored.
//
// Age comes from the newest descendant mtime (subtreeStats), not the dir's
// own mtime, so an unrelated metadata touch can't mask a genuinely stale dir.
func scanFileHistory(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	dir := filepath.Join(spec.Root, "file-history")
	entries, ok, err := openDirNoSymlink(dir)
	if err != nil || !ok {
		return []Candidate{}, err
	}

	out := []Candidate{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !e.IsDir() {
			continue // file-history/ is per-UUID dirs; stray files are not ours to judge
		}
		uuidDir := filepath.Join(dir, e.Name())
		bytes, files, newest, err := subtreeStats(ctx, uuidDir)
		if err != nil {
			return nil, err
		}

		if files == 0 {
			out = append(out, Candidate{
				Path: uuidDir, Bytes: bytes, Files: files, ModTime: newest,
				Reason: "empty history dir", Group: "empty",
				Meta: map[string]string{"uuid": e.Name()},
			})
			continue
		}
		if !olderThan(newest, spec) {
			continue
		}
		out = append(out, Candidate{
			Path: uuidDir, Bytes: bytes, Files: files, ModTime: newest,
			Reason: "no edits in 30+ days", Group: "stale",
			Meta: map[string]string{"uuid": e.Name()},
		})
	}
	return out, nil
}
