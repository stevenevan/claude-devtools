package paritytest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"claude-devtools/internal/watcher"
)

// watcherEventsPath is shared with the Rust cargo test
// (src-tauri/src/watcher parsers golden), which loads the same JSON and asserts
// parse_project_file/parse_todo_file produce the same FileChangeEvent. Cross-
// language byte-parity on the event shape; no FS / time dependence.
const watcherEventsPath = "testdata/watcher_events.golden.json"

// watcherCase is one parse input + its expected event (nil when the parser
// rejects the path). `kind` selects the parser; `dir` is the watch root.
type watcherCase struct {
	Kind       string                   `json:"kind"` // "project" | "todo"
	Dir        string                   `json:"dir"`
	Path       string                   `json:"path"`
	ChangeType string                   `json:"changeType"`
	Event      *watcher.FileChangeEvent `json:"event"`
}

// Synthetic paths only — no real ~/.claude content. Covers every branch of both
// parsers: session file, subagent file, non-jsonl, wrong depth, all change
// types, todo basic/non-json/unlink.
func watcherCases() []watcherCase {
	const pd = "/w/projects"
	const td = "/w/todos"
	mk := func(kind, dir, path, ct string) watcherCase {
		var ev *watcher.FileChangeEvent
		if kind == "project" {
			ev = watcher.ParseProjectFile(dir, path, ct)
		} else {
			ev = watcher.ParseTodoFile(dir, path, ct)
		}
		return watcherCase{Kind: kind, Dir: dir, Path: path, ChangeType: ct, Event: ev}
	}
	return []watcherCase{
		mk("project", pd, pd+"/-Users-a-proj/sess.jsonl", "add"),
		mk("project", pd, pd+"/-Users-a-proj/sess/subagents/agent-abc.jsonl", "change"),
		mk("project", pd, pd+"/-Users-a-proj/notes.txt", "add"),   // non-jsonl → nil
		mk("project", pd, pd+"/loose.jsonl", "add"),               // depth 1 → nil
		mk("project", pd, pd+"/-p/sess/extra.jsonl", "unlink"),    // depth 3 → nil
		mk("project", pd, pd+"/-p/sess/notsub/a.jsonl", "add"),    // depth 4 wrong dir → nil
		mk("project", pd, pd+"/-p/s.jsonl", "unlink"),
		mk("todo", td, td+"/sess.json", "add"),
		mk("todo", td, td+"/9f8e-uuid.json", "unlink"),
		mk("todo", td, td+"/notes.txt", "change"), // non-json → nil
	}
}

// TestWatcherEventsGolden generates (GEN_GOLDENS=1) or verifies the shared
// watcher_events.golden.json against the current Go parsers. A green run on both
// Go and Rust proves cross-language event-shape parity.
func TestWatcherEventsGolden(t *testing.T) {
	cases := watcherCases()
	got, err := json.MarshalIndent(cases, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	golden := filepath.Clean(watcherEventsPath)
	if os.Getenv("GEN_GOLDENS") == "1" {
		if err := os.WriteFile(golden, append(got, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", golden)
		return
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatalf("read golden (GEN_GOLDENS=1 to create): %v", err)
	}
	if g, w := canon(t, got), canon(t, want); g != w {
		t.Errorf("watcher events golden mismatch\n got: %s\nwant: %s", g, w)
	}
}
