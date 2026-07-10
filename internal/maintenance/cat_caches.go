package maintenance

import (
	"context"
	"os"
	"path/filepath"
)

func init() { registerMatcher("caches", 0, scanCaches) }

// cacheSurfaces is the KNOWN-SURFACE ALLOWLIST — never a *cache* glob. Each
// entry justifies its clearability with who rebuilds it; a file with no note
// gets no clear button (it isn't listed here).
var cacheSurfaces = []struct{ rel, regeneratedBy string }{
	{"cache/changelog.md", "CLI update check"},
	{"stats-cache.json", "usage tracking"},
	{"mcp-needs-auth-cache.json", "next MCP probe"},
}

// scanCaches surfaces the small regenerable caches (plain-delete). paste-cache
// blobs may hold pasted secrets — flagged sensitive and, being regenerable,
// plain-deleted (no trash copy that would extend retention).
func scanCaches(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	out := []Candidate{}
	for _, s := range cacheSurfaces {
		p := filepath.Join(spec.Root, s.rel)
		info, err := os.Lstat(p)
		if err != nil || info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		out = append(out, Candidate{
			Path: p, Bytes: info.Size(), Files: 1, ModTime: info.ModTime(),
			Reason: "cache — rebuilt on demand",
			Meta:   map[string]string{"regeneratedBy": s.regeneratedBy},
		})
	}

	pasteDir := filepath.Join(spec.Root, "paste-cache")
	entries, ok, err := openDirNoSymlink(pasteDir)
	if err != nil {
		return nil, err
	}
	if ok {
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
			out = append(out, Candidate{
				Path: filepath.Join(pasteDir, e.Name()), Bytes: info.Size(), Files: 1,
				ModTime: info.ModTime(), Reason: "pasted content — may contain sensitive text",
				Group: "paste-cache",
				Meta:  map[string]string{"regeneratedBy": "next paste", "sensitive": "true"},
			})
		}
	}
	return out, nil
}
