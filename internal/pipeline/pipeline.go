// Package pipeline is the gate-path entry point: JSONL file → SessionDetail JSON,
// reproducing the Rust CLI's `show-session --format json`. It is wired but not
// yet implemented — W3 ports parsing/, W4 ports analysis/ and fills this in.
package pipeline

import "errors"

// ErrNotPorted marks the pipeline stages still pending (W3/W4). The parity gate
// skips while this is returned, then runs for real once BuildSessionDetailJSON
// produces output.
var ErrNotPorted = errors.New("pipeline: BuildSessionDetail not yet ported (W3/W4)")

// BuildSessionDetailJSON parses the session JSONL for (projectID, sessionID) and
// returns the SessionDetail as JSON, matching the Rust CLI byte-for-byte after
// key-sort normalization. The Go CLI replicates cli.rs:168-186 Session stub
// fields and passes an empty processes slice.
func BuildSessionDetailJSON(projectID, sessionID string) ([]byte, error) {
	return nil, ErrNotPorted
}
