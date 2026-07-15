package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"claude-devtools/internal/discovery"
)

func init() { registerMatcher("projects", 90, scanProjects) }

// scanProjects surfaces old session JSONL under <root>/projects — the app's OWN
// input store. One candidate per session file older than the cutoff (default
// 90d), grouped by the decoded human-readable project path. Candidates carry
// Meta["projectId"] = the REAL domain.Project.ID (composite `<enc>::<hash>` for
// split multi-cwd projects), so cache eviction and sidebar refresh target the
// exact project, not the raw encoded dir. Pinned sessions (spec.Pinned) are
// flagged so the panel excludes them from bulk selection. Today's sessions are
// never candidates (≈ ongoing-session exclusion — the CLI may be appending).
func scanProjects(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	projectsDir := filepath.Join(spec.Root, "projects")
	encoded, ok, err := openDirNoSymlink(projectsDir)
	if err != nil || !ok {
		return []Candidate{}, err
	}

	sessionProject := resolveSessionProjects(projectsDir)
	pinned := make(map[string]bool, len(spec.Pinned))
	for _, id := range spec.Pinned {
		pinned[id] = true
	}

	out := []Candidate{}
	for _, projEntry := range encoded {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !projEntry.IsDir() {
			continue
		}
		enc := projEntry.Name()
		projDir := filepath.Join(projectsDir, enc)
		decoded := discovery.DecodePath(enc)

		sessions, ok, err := openDirNoSymlink(projDir)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		for _, s := range sessions {
			if s.IsDir() || !strings.HasSuffix(s.Name(), ".jsonl") {
				continue
			}
			info, infoErr := s.Info()
			if infoErr != nil || info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			mtime := info.ModTime()
			if !olderThan(mtime, spec) {
				continue
			}
			sid := strings.TrimSuffix(s.Name(), ".jsonl")
			projectID := enc
			if pj, ok := sessionProject[sid]; ok {
				projectID = pj
			}
			meta := map[string]string{
				"encoded":   enc,
				"project":   decoded,
				"sessionId": sid,
				"projectId": projectID,
			}
			if pinned[sid] {
				meta["pinned"] = "true"
			}
			out = append(out, Candidate{
				Path: filepath.Join(projDir, s.Name()), Bytes: info.Size(), Files: 1,
				ModTime: mtime, Reason: "old session", Group: decoded, Meta: meta,
			})
		}
	}
	return out, nil
}

// resolveSessionProjects maps sessionID → real domain.Project.ID via the
// discovery scanner (composite-id aware). Best-effort: a scan error yields an
// empty map and callers fall back to the encoded dir name.
func resolveSessionProjects(projectsDir string) map[string]string {
	projects, err := discovery.ScanProjects(projectsDir, discovery.NewSubprojectRegistry())
	if err != nil {
		return map[string]string{}
	}
	m := make(map[string]string)
	for _, p := range projects {
		for _, sid := range p.Sessions {
			m[sid] = p.ID
		}
	}
	return m
}
