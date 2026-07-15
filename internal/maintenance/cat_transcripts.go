package maintenance

import (
	"context"
	"os"
	"path/filepath"
)

func init() { registerMatcher("transcripts", 90, scanTranscripts) }

// scanTranscripts surfaces stale transcript files under <root>/transcripts —
// flat machine-generated ses_*.jsonl logs the CLI writes and never prunes.
// Candidates are files older than the cutoff (default 90d), grouped by the
// month they were last written (lexical "YYYY-MM") so a bucket = one decision.
// Live ModTime decides staleness — if the CLI resumes writing, fresh files
// simply drop out.
func scanTranscripts(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	dir := filepath.Join(spec.Root, "transcripts")
	entries, ok, err := openDirNoSymlink(dir)
	if err != nil || !ok {
		return []Candidate{}, err
	}

	out := []Candidate{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if e.IsDir() {
			continue // transcripts are flat files
		}
		info, err := e.Info()
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		mtime := info.ModTime()
		if !olderThan(mtime, spec) {
			continue
		}
		out = append(out, Candidate{
			Path:    filepath.Join(dir, e.Name()),
			Bytes:   info.Size(),
			Files:   1,
			ModTime: mtime,
			Reason:  "stale transcript",
			Group:   mtime.Format("2006-01"),
		})
	}
	return out, nil
}
