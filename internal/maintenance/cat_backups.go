package maintenance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func init() { registerMatcher("backup-binaries", 0, scanBackupBinaries) }

// scanBackupBinaries flags `*.bak` backup siblings of the status-line / hook
// binaries in <root> and <root>/hooks. Each carries a sha256 and, when an
// active sibling exists, an `identical` flag (same bytes = pure duplicate vs
// distinct = a real rollback point). A file whose path is in spec.Active (the
// binaries live settings.json references) is NEVER a candidate. No age gate.
func scanBackupBinaries(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	active := make(map[string]bool, len(spec.Active))
	activeSum := map[string]string{} // (dir\x00base) → active binary checksum
	for _, p := range spec.Active {
		active[filepath.Clean(p)] = true
		if sum, err := fileSHA256(p); err == nil {
			activeSum[dirBaseKey(filepath.Dir(p), backupBaseName(filepath.Base(p)))] = sum
		}
	}

	out := []Candidate{}
	for _, dir := range []string{spec.Root, filepath.Join(spec.Root, "hooks")} {
		entries, ok, err := openDirNoSymlink(dir)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		for _, e := range entries {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".bak") {
				continue
			}
			path := filepath.Join(dir, e.Name())
			if active[filepath.Clean(path)] {
				continue // active binaries are never candidates
			}
			info, infoErr := e.Info()
			if infoErr != nil || info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			sum, err := fileSHA256(path)
			if err != nil {
				continue
			}
			base := backupBaseName(e.Name())
			meta := map[string]string{"base": base, "checksum": sum}
			reason := "backup binary"
			if aSum, ok := activeSum[dirBaseKey(dir, base)]; ok {
				identical := aSum == sum
				meta["identical"] = boolStr(identical)
				if identical {
					reason = "duplicate of the active binary"
				} else {
					reason = "distinct backup (rollback point)"
				}
			}
			out = append(out, Candidate{
				Path: path, Bytes: info.Size(), Files: 1, ModTime: info.ModTime(),
				Reason: reason, Group: base, Meta: meta,
			})
		}
	}
	return out, nil
}

// backupBaseName is the binary family key: the file name up to its first dot
// ("status-line.bin.bak" and "status-line.pre-x.bak" → "status-line").
func backupBaseName(name string) string {
	if i := strings.IndexByte(name, '.'); i > 0 {
		return name[:i]
	}
	return name
}

func dirBaseKey(dir, base string) string { return dir + "\x00" + base }

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
