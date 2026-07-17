package paritytest

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"claude-devtools/internal/pipeline"
)

// rustCLI is the CLI twin build artifact, relative to this package dir.
func rustCLI() string {
	return filepath.Join("..", "..", "src-tauri", "target", "debug", "claude-devtools-cli")
}

// TestCLIParityRealCorpus is the W7 "CLI JSON diff green" gate: Go (in-process
// pipeline, identical to `cmd/cli show-session`) vs the Rust CLI twin over the
// local real corpus (~/.claude/projects). It VISIBLE-SKIPS when the Rust binary
// is absent or no corpus exists, so a bare `go test ./...` without a prior
// `cargo build --bin claude-devtools-cli` stays green (and reports the skip).
func TestCLIParityRealCorpus(t *testing.T) {
	rust := rustCLI()
	if _, err := os.Stat(rust); err != nil {
		t.Skipf("rust cli not built: %s (run: cd src-tauri && cargo build --bin claude-devtools-cli)", rust)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}
	sessions, _ := filepath.Glob(filepath.Join(home, ".claude", "projects", "*", "*.jsonl"))
	if len(sessions) == 0 {
		t.Skip("no local ~/.claude/projects corpus")
	}

	const maxSessions = 25
	checked := 0
	for _, sp := range sessions {
		if checked >= maxSessions {
			break
		}
		projectID := filepath.Base(filepath.Dir(sp))
		sessionID := strings.TrimSuffix(filepath.Base(sp), ".jsonl")

		goJSON, err := pipeline.BuildSessionDetailJSON(projectID, sessionID)
		if err != nil {
			continue // skip sessions the Go side can't build (e.g. odd IDs)
		}
		out, err := exec.Command(rust, "show-session", projectID, sessionID, "--format", "json").Output()
		if err != nil {
			t.Errorf("rust cli %s/%s: %v", projectID, sessionID, err)
			continue
		}
		if canon(t, goJSON) != canon(t, out) {
			t.Errorf("CLI parity mismatch for %s/%s", projectID, sessionID)
		}
		checked++
	}
	if checked == 0 {
		t.Skip("no comparable sessions in the local corpus")
	}
	t.Logf("CLI parity: %d real sessions Go==Rust", checked)
}
