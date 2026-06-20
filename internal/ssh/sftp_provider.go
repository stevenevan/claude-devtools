// Package ssh — sftp_provider.go ports src-tauri/src/ssh/sftp_provider.rs.
// RemoteFileTail tracks the byte offset for a remote JSONL file and surfaces
// complete lines from incremental chunks. TailRegistry manages per-path tails.
// PURE: no network I/O; fully unit-testable.
package ssh

import (
	"strings"
)

// RemoteFileTail mirrors RemoteFileTail.
type RemoteFileTail struct {
	// Offset is the total bytes consumed from the remote file (post-line-merge).
	Offset  uint64
	pending string
}

// NewRemoteFileTail mirrors RemoteFileTail::new.
func NewRemoteFileTail() *RemoteFileTail {
	return &RemoteFileTail{}
}

// Reset mirrors RemoteFileTail::reset — zeroes offset and clears pending fragment.
func (t *RemoteFileTail) Reset() {
	t.Offset = 0
	t.pending = ""
}

// ApplyChunk mirrors RemoteFileTail::apply_chunk — feed a raw byte slice read
// at the current offset, receive complete lines back.
func (t *RemoteFileTail) ApplyChunk(chunk []byte) []string {
	if len(chunk) == 0 {
		return []string{}
	}
	t.Offset += uint64(len(chunk))
	// Lossy UTF-8 conversion mirrors Rust's String::from_utf8_lossy.
	t.pending += strings.ToValidUTF8(string(chunk), "�")

	var lines []string
	for {
		idx := strings.IndexByte(t.pending, '\n')
		if idx < 0 {
			break
		}
		line := t.pending[:idx]
		line = strings.TrimSuffix(line, "\r")
		lines = append(lines, line)
		t.pending = t.pending[idx+1:]
	}
	if lines == nil {
		return []string{}
	}
	return lines
}

// TailRegistry mirrors TailRegistry — per-connection registry keyed by path.
type TailRegistry struct {
	tails map[string]*RemoteFileTail
}

// NewTailRegistry returns an empty registry.
func NewTailRegistry() *TailRegistry {
	return &TailRegistry{tails: map[string]*RemoteFileTail{}}
}

// GetOrInit mirrors TailRegistry::get_or_init.
func (r *TailRegistry) GetOrInit(path string) *RemoteFileTail {
	if t, ok := r.tails[path]; ok {
		return t
	}
	t := NewRemoteFileTail()
	r.tails[path] = t
	return t
}

// Remove mirrors TailRegistry::remove.
func (r *TailRegistry) Remove(path string) {
	delete(r.tails, path)
}

// KnownPaths mirrors TailRegistry::known_paths.
func (r *TailRegistry) KnownPaths() []string {
	paths := make([]string, 0, len(r.tails))
	for p := range r.tails {
		paths = append(paths, p)
	}
	return paths
}
