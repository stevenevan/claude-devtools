package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

func init() {
	registerMatcher("logs", 0, scanLogs)
	registerMatcher("logs-daemon", 0, scanLogsDaemon)
}

// scanLogs lists devtools log files under <root>/logs (plain-delete). The
// current Go build writes no file logs — these are stale Tauri/Rust leftovers.
func scanLogs(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	dir := filepath.Join(spec.Root, "logs")
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
		out = append(out, Candidate{
			Path: filepath.Join(dir, e.Name()), Bytes: info.Size(), Files: 1,
			ModTime: info.ModTime(), Reason: "devtools log file",
			Meta: map[string]string{"owner": "app"},
		})
	}
	return out, nil
}

// scanLogsDaemon lists the CLI daemon log (+ rotated daemon.log.N) at the root.
// These are TRUNCATE-cleared (never unlinked) so a live daemon holding the fd
// keeps writing to the same inode and the space actually frees.
func scanLogsDaemon(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	entries, ok, err := openDirNoSymlink(spec.Root)
	if err != nil || !ok {
		return []Candidate{}, err
	}
	out := []Candidate{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		name := e.Name()
		if e.IsDir() || (name != "daemon.log" && !strings.HasPrefix(name, "daemon.log.")) {
			continue
		}
		info, infoErr := e.Info()
		if infoErr != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		out = append(out, Candidate{
			Path: filepath.Join(spec.Root, name), Bytes: info.Size(), Files: 1,
			ModTime: info.ModTime(), Reason: "CLI daemon log (cleared by truncate)",
			Meta: map[string]string{"owner": "daemon"},
		})
	}
	return out, nil
}
