package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

func init() { registerMatcher("plans", 60, scanPlans) }

// scanPlans lists every plan file under <root>/plans as a candidate — nothing
// is preselected, deletion is always an explicit choice. Staleness (older than
// the cutoff, default 60d) is surfaced as a Meta badge, NOT a candidacy filter:
// an old plan can be the only record of a design decision. Variant siblings (a
// plan plus its agent-variant files sharing a base name) are grouped so they're
// reviewed together; singletons stay ungrouped to avoid header noise.
func scanPlans(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	dir := filepath.Join(spec.Root, "plans")
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
			continue
		}
		info, infoErr := e.Info()
		if infoErr != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		mtime := info.ModTime()
		meta := map[string]string{"name": e.Name()}
		if olderThan(mtime, spec) {
			meta["stale"] = "true"
		}
		out = append(out, Candidate{
			Path: filepath.Join(dir, e.Name()), Bytes: info.Size(), Files: 1,
			ModTime: mtime, Reason: "plan document",
			Group: planBaseName(e.Name()), Meta: meta,
		})
	}

	// Ungroup singletons: a variant group only helps when siblings exist.
	counts := map[string]int{}
	for _, c := range out {
		counts[c.Group]++
	}
	for i := range out {
		if counts[out[i].Group] < 2 {
			out[i].Group = ""
		}
	}
	return out, nil
}

// planBaseName groups a plan with its variant siblings: the filename up to its
// first dot ("foo.md" and "foo.agent.md" → "foo").
func planBaseName(name string) string {
	if i := strings.IndexByte(name, '.'); i > 0 {
		return name[:i]
	}
	return name
}
