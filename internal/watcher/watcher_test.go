package watcher_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rjeczalik/notify"

	"claude-devtools/internal/watcher"
)

// ---------------------------------------------------------------------------
// MapEventKind — mirrors Rust test_map_event_kind_* tests
// ---------------------------------------------------------------------------

func TestMapEventKind(t *testing.T) {
	tests := []struct {
		name    string
		event   notify.Event
		wantStr string
		wantOK  bool
	}{
		// test_map_event_kind_create
		{name: "create→add", event: notify.Create, wantStr: "add", wantOK: true},
		// test_map_event_kind_modify
		{name: "write→change", event: notify.Write, wantStr: "change", wantOK: true},
		// test_map_event_kind_remove
		{name: "remove→unlink", event: notify.Remove, wantStr: "unlink", wantOK: true},
		// rename is treated as unlink (old name disappears)
		{name: "rename→unlink", event: notify.Rename, wantStr: "unlink", wantOK: true},
		// test_map_event_kind_access_returns_none / test_map_event_kind_other_returns_none
		{name: "zero→none", event: notify.Event(0), wantStr: "", wantOK: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := watcher.MapEventKind(tc.event)
			if ok != tc.wantOK {
				t.Errorf("ok: want %v, got %v", tc.wantOK, ok)
			}
			if got != tc.wantStr {
				t.Errorf("kind: want %q, got %q", tc.wantStr, got)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// ParseProjectFile — mirrors Rust test_parse_project_file_* tests
// ---------------------------------------------------------------------------

func TestParseProjectFile(t *testing.T) {
	projects := "/home/user/.claude/projects"

	t.Run("session_file", func(t *testing.T) {
		// test_parse_project_file_session
		file := "/home/user/.claude/projects/-Users-name-project/abc123.jsonl"
		evt := watcher.ParseProjectFile(projects, file, "change")
		if evt == nil {
			t.Fatal("want event, got nil")
		}
		if evt.ProjectID == nil || *evt.ProjectID != "-Users-name-project" {
			t.Errorf("projectId: want -Users-name-project, got %v", evt.ProjectID)
		}
		if evt.SessionID == nil || *evt.SessionID != "abc123" {
			t.Errorf("sessionId: want abc123, got %v", evt.SessionID)
		}
		if evt.IsSubagent {
			t.Error("isSubagent: want false")
		}
		if evt.Type != "change" {
			t.Errorf("type: want change, got %s", evt.Type)
		}
	})

	t.Run("subagent_file", func(t *testing.T) {
		// test_parse_project_file_subagent
		file := "/home/user/.claude/projects/-Users-name-project/abc123/subagents/agent-def456.jsonl"
		evt := watcher.ParseProjectFile(projects, file, "add")
		if evt == nil {
			t.Fatal("want event, got nil")
		}
		if evt.ProjectID == nil || *evt.ProjectID != "-Users-name-project" {
			t.Errorf("projectId: want -Users-name-project, got %v", evt.ProjectID)
		}
		if evt.SessionID == nil || *evt.SessionID != "abc123" {
			t.Errorf("sessionId: want abc123, got %v", evt.SessionID)
		}
		if !evt.IsSubagent {
			t.Error("isSubagent: want true")
		}
		if evt.Type != "add" {
			t.Errorf("type: want add, got %s", evt.Type)
		}
	})

	t.Run("ignores_non_jsonl", func(t *testing.T) {
		// test_parse_project_file_ignores_non_jsonl
		file := "/home/user/.claude/projects/-Users-name-project/README.md"
		if evt := watcher.ParseProjectFile(projects, file, "change"); evt != nil {
			t.Errorf("want nil, got %+v", evt)
		}
	})

	t.Run("ignores_wrong_depth_1", func(t *testing.T) {
		// test_parse_project_file_ignores_wrong_depth (project dir itself, no file)
		file := "/home/user/.claude/projects/-Users-name-project"
		if evt := watcher.ParseProjectFile(projects, file, "change"); evt != nil {
			t.Errorf("want nil, got %+v", evt)
		}
	})

	t.Run("ignores_3_components", func(t *testing.T) {
		// test_parse_project_file_ignores_3_components
		file := "/home/user/.claude/projects/-Users-name-project/abc123/random.jsonl"
		if evt := watcher.ParseProjectFile(projects, file, "change"); evt != nil {
			t.Errorf("want nil, got %+v", evt)
		}
	})

	t.Run("preserves_absolute_path", func(t *testing.T) {
		// test_parse_project_file_preserves_path
		file := "/home/user/.claude/projects/-Users-name-project/session1.jsonl"
		evt := watcher.ParseProjectFile(projects, file, "add")
		if evt == nil {
			t.Fatal("want event, got nil")
		}
		if evt.Path != file {
			t.Errorf("path: want %s, got %s", file, evt.Path)
		}
	})

	t.Run("all_change_types", func(t *testing.T) {
		// test_parse_project_file_different_change_types
		file := "/home/user/.claude/projects/-Users-name-project/s1.jsonl"
		for _, ct := range []string{"add", "change", "unlink"} {
			evt := watcher.ParseProjectFile(projects, file, ct)
			if evt == nil {
				t.Fatalf("changeType=%s: want event, got nil", ct)
			}
			if evt.Type != ct {
				t.Errorf("changeType=%s: type field: want %s, got %s", ct, ct, evt.Type)
			}
		}
	})
}

// ---------------------------------------------------------------------------
// ParseTodoFile — mirrors Rust test_parse_todo_file_* tests
// ---------------------------------------------------------------------------

func TestParseTodoFile(t *testing.T) {
	todos := "/home/user/.claude/todos"

	t.Run("basic", func(t *testing.T) {
		// test_parse_todo_file
		file := "/home/user/.claude/todos/abc123.json"
		evt := watcher.ParseTodoFile(todos, file, "change")
		if evt == nil {
			t.Fatal("want event, got nil")
		}
		if evt.SessionID == nil || *evt.SessionID != "abc123" {
			t.Errorf("sessionId: want abc123, got %v", evt.SessionID)
		}
		if evt.ProjectID != nil {
			t.Errorf("projectId: want nil, got %v", evt.ProjectID)
		}
		if evt.IsSubagent {
			t.Error("isSubagent: want false")
		}
		if evt.Type != "change" {
			t.Errorf("type: want change, got %s", evt.Type)
		}
	})

	t.Run("ignores_non_json", func(t *testing.T) {
		// test_parse_todo_file_ignores_non_json
		file := "/home/user/.claude/todos/abc123.txt"
		if evt := watcher.ParseTodoFile(todos, file, "change"); evt != nil {
			t.Errorf("want nil, got %+v", evt)
		}
	})

	t.Run("unlink", func(t *testing.T) {
		// test_parse_todo_file_unlink
		file := "/home/user/.claude/todos/session-uuid.json"
		evt := watcher.ParseTodoFile(todos, file, "unlink")
		if evt == nil {
			t.Fatal("want event, got nil")
		}
		if evt.SessionID == nil || *evt.SessionID != "session-uuid" {
			t.Errorf("sessionId: want session-uuid, got %v", evt.SessionID)
		}
		if evt.Type != "unlink" {
			t.Errorf("type: want unlink, got %s", evt.Type)
		}
	})

	t.Run("uuid_session_id", func(t *testing.T) {
		// test_parse_todo_file_session_id_with_uuid
		file := "/home/user/.claude/todos/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json"
		evt := watcher.ParseTodoFile(todos, file, "change")
		if evt == nil {
			t.Fatal("want event, got nil")
		}
		want := "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
		if evt.SessionID == nil || *evt.SessionID != want {
			t.Errorf("sessionId: want %s, got %v", want, evt.SessionID)
		}
	})
}

// ---------------------------------------------------------------------------
// ResolveClaudeDir — mirrors Rust test_resolve_claude_dir_uses_home
// ---------------------------------------------------------------------------

func TestResolveClaudeDir(t *testing.T) {
	// test_resolve_claude_dir_uses_home: should resolve to some path.
	dir, ok := watcher.ResolveClaudeDir()
	if !ok {
		t.Error("ResolveClaudeDir: want ok=true, got false")
	}
	if dir == "" {
		t.Error("ResolveClaudeDir: want non-empty path")
	}
}

// ---------------------------------------------------------------------------
// Integration: real notify watch + debounce
// ---------------------------------------------------------------------------

// TestIntegration_DebouncedFileChange creates a real temp-dir watcher, writes a
// file 5 times in rapid succession, and asserts exactly ONE debounced file-change
// event arrives within 3 s. Skipped gracefully on platforms where temp-dir
// watching fails.
func TestIntegration_DebouncedFileChange(t *testing.T) {
	tmpDir := t.TempDir()
	// Resolve symlinks so event paths from FSEvents match our prefix checks.
	// On macOS /tmp → /private/tmp; without resolution isUnder would return false.
	realTmp, err := filepath.EvalSymlinks(tmpDir)
	if err != nil {
		realTmp = tmpDir
	}

	projectsDir := filepath.Join(realTmp, "projects")
	projectSubDir := filepath.Join(projectsDir, "-test-project")
	todosDir := filepath.Join(realTmp, "todos")

	for _, d := range []string{projectSubDir, todosDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	type received struct {
		event   string
		payload any
	}
	events := make(chan received, 10)
	r := watcher.New(projectsDir, todosDir, "", "", func(event string, payload any) {
		select {
		case events <- received{event, payload}:
		default:
		}
	})

	if err := r.Start(); err != nil {
		t.Skipf("watcher.Start failed (platform may not support watching): %v", err)
	}
	defer r.Stop()

	// Give the watcher time to initialise before triggering events.
	time.Sleep(200 * time.Millisecond)

	// Write the same file 5 times within ~50 ms — all within the 100 ms debounce
	// window. Expect exactly ONE coalesced event.
	filePath := filepath.Join(projectSubDir, "session1.jsonl")
	for i := 0; i < 5; i++ {
		if err := os.WriteFile(filePath, []byte(`{"seq":0}`), 0o644); err != nil {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Generous 3 s timeout: FSEvents can batch-deliver with latency up to ~500 ms.
	select {
	case ev := <-events:
		if ev.event != "file-change" {
			t.Errorf("event name: want file-change, got %s", ev.event)
		}
		fce, ok := ev.payload.(*watcher.FileChangeEvent)
		if !ok {
			t.Fatalf("payload type: want *FileChangeEvent, got %T", ev.payload)
		}
		if fce.ProjectID == nil || *fce.ProjectID != "-test-project" {
			t.Errorf("projectId: want -test-project, got %v", fce.ProjectID)
		}
		if fce.SessionID == nil || *fce.SessionID != "session1" {
			t.Errorf("sessionId: want session1, got %v", fce.SessionID)
		}
		if fce.IsSubagent {
			t.Error("isSubagent: want false")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no file-change event within 3 s")
	}

	// Allow 400 ms to confirm debounce produced no extra events.
	select {
	case extra := <-events:
		t.Errorf("unexpected extra event after debounce: %s", extra.event)
	case <-time.After(400 * time.Millisecond):
		// correct: debounce coalesced 5 writes into 1
	}
}

// TestIntegration_ConfigFileChange verifies a settings.json write via
// temp+rename (which breaks a direct-file watch) still surfaces one debounced
// config-file-change from the parent-dir watch (W15-T3).
func TestIntegration_ConfigFileChange(t *testing.T) {
	tmpDir := t.TempDir()
	realTmp, err := filepath.EvalSymlinks(tmpDir)
	if err != nil {
		realTmp = tmpDir
	}
	configDir := realTmp
	projectsDir := filepath.Join(realTmp, "projects")
	todosDir := filepath.Join(realTmp, "todos")
	for _, d := range []string{projectsDir, todosDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	events := make(chan string, 10)
	r := watcher.New(projectsDir, todosDir, configDir, "", func(event string, _ any) {
		select {
		case events <- event:
		default:
		}
	})
	if err := r.Start(); err != nil {
		t.Skipf("watcher.Start failed: %v", err)
	}
	defer r.Stop()
	time.Sleep(200 * time.Millisecond)

	// Atomic write: settings.json.tmp then rename over settings.json.
	settingsPath := filepath.Join(configDir, "settings.json")
	tmpPath := settingsPath + ".tmp"
	if err := os.WriteFile(tmpPath, []byte(`{"theme":"dark"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tmpPath, settingsPath); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-events:
			if ev == "config-file-change" {
				return // success
			}
		case <-deadline:
			t.Fatal("no config-file-change event within 3 s")
		}
	}
}

// TestIntegration_ClaudeJSONChange verifies a ~/.claude.json write via
// temp+rename in a fixture home dir surfaces one config-file-change from the
// home-dir watch (W20). Mirrors the settings.json config-change test.
func TestIntegration_ClaudeJSONChange(t *testing.T) {
	tmpDir := t.TempDir()
	realTmp, err := filepath.EvalSymlinks(tmpDir)
	if err != nil {
		realTmp = tmpDir
	}
	homeDir := realTmp
	projectsDir := filepath.Join(realTmp, ".claude", "projects")
	todosDir := filepath.Join(realTmp, ".claude", "todos")
	for _, d := range []string{projectsDir, todosDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	events := make(chan string, 10)
	r := watcher.New(projectsDir, todosDir, "", homeDir, func(event string, _ any) {
		select {
		case events <- event:
		default:
		}
	})
	if err := r.Start(); err != nil {
		t.Skipf("watcher.Start failed: %v", err)
	}
	defer r.Stop()
	time.Sleep(200 * time.Millisecond)

	// Atomic write: ~/.claude.json.tmp then rename over ~/.claude.json.
	claudeJSONPath := filepath.Join(homeDir, ".claude.json")
	tmpPath := claudeJSONPath + ".tmp"
	if err := os.WriteFile(tmpPath, []byte(`{"numStartups":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tmpPath, claudeJSONPath); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-events:
			if ev == "config-file-change" {
				return // success
			}
		case <-deadline:
			t.Fatal("no config-file-change event within 3 s")
		}
	}
}
