# Week 3 — Port `parsing/` + File Watcher

**Objective:** JSONL → `ParsedMessage` → `MessageCategory` works in Go and matches
Rust on unit fixtures; the file watcher emits `file-change`/`todo-change`.

**Prerequisites:** Week 2 skeleton + golden harness.

## Tickets

### W3-T1 — Port `parsing/session_parser.rs`
- Streaming, line-by-line reader (`bufio.Scanner` with a large buffer — JSONL lines
  can exceed the default 64KB token; set `scanner.Buffer(make([]byte, 1024*1024), 16*1024*1024)`).
- Preserve line numbers (used by `session_scroll_to_line`).
- Verify: line count + raw JSON values match Rust on a fixture file.

### W3-T2 — Port `parsing/entry_parser.rs` → `ParsedMessage`
- Handles all roles + content types (text, thinking, tool_use, tool_result, images).
- This is the densest file — port struct-by-struct, test each content variant.
- Verify: deserialize a fixture, assert field-level equality with Rust output.

### W3-T3 — Port `message_classifier.rs` → `MessageCategory`
- Categories: `HardNoise | User | Ai | System | Event | Compact`.
- The `isMeta` rule is load-bearing (`false` = real user turn). Port `category_rules.rs`
  verbatim; reuse the Rust `*_tests.rs` cases as Go table tests.
- Verify: category for every message in a fixture matches Rust.

### W3-T4 — Port `tool_extraction.rs`, `metrics.rs`, `deduplication.rs`
- `tool_extraction`: pull tool_use/tool_result blocks out of content arrays.
- `metrics`: token/cost/duration aggregation (depends on tokenizer stub for now;
  finalize counts in W4 once tiktoken-go lands).
- `deduplication`: dup-message removal.
- Verify: per-module table tests ported from Rust.

### W3-T5 — File watcher as a v3 service (rjeczalik/notify + debounce)
Make the watcher a Wails v3 service; `ServiceStartup` gives it ctx and starts watching,
`ServiceShutdown` stops it. Events go through the app singleton — no ctx needed at emit.
```go
package watcherservice

import (
	"context"
	"path/filepath"
	"sync"
	"time"

	"github.com/rjeczalik/notify"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Watcher struct {
	c chan notify.EventInfo
}

func (w *Watcher) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	projectsPath := claroot.CanonicalProjects() // immutable, resolved once
	todosPath := claroot.TodosDir()             // ~/.claude/todos

	w.c = make(chan notify.EventInfo, 256)
	// "/..." = recursive (FSEvents on macOS, ReadDirectoryChangesW on Windows)
	if err := notify.Watch(filepath.Join(projectsPath, "..."), w.c,
		notify.Create, notify.Write, notify.Remove, notify.Rename); err != nil {
		return err
	}
	if err := notify.Watch(filepath.Join(todosPath, "..."), w.c, notify.All); err != nil {
		return err
	}
	go w.loop()
	return nil
}
func (w *Watcher) ServiceShutdown() error { notify.Stop(w.c); return nil }

func (w *Watcher) loop() {
	const debounce = 100 * time.Millisecond // matches Rust DEBOUNCE_MS
	var mu sync.Mutex
	pending := map[string]FileChangeEvent{}
	var timer *time.Timer
	app := application.Get()
	flush := func() {
		mu.Lock()
		batch := pending
		pending = map[string]FileChangeEvent{}
		mu.Unlock()
		for _, ev := range batch {
			name := "file-change"
			if ev.IsTodo { name = "todo-change" }
			app.Event.Emit(name, ev)
		}
	}
	for ev := range w.c {
		mu.Lock()
		pending[ev.Path()] = classify(ev) // map kind like map_event_kind in parsers.rs
		if timer == nil { timer = time.AfterFunc(debounce, flush) } else { timer.Reset(debounce) }
		mu.Unlock()
	}
}
```
- Register `application.NewService(&watcherservice.Watcher{})` in `main.go`.
- Source `projectsPath` from the immutable `ClaudeRoot` (canonical, resolved once);
  `todosPath` = `~/.claude/todos` (matches Rust security note in `lifecycle.rs`).
- Verify: `touch` a JSONL under `~/.claude/projects`, confirm one debounced `file-change`
  fires in the frontend console (temporary `Events.On('file-change', …)` during `wails3 dev`).

## Exit criteria
- [ ] `parsing/` Go modules pass ported unit tests against Rust fixtures.
- [ ] Watcher emits debounced `file-change`/`todo-change` recursively, no fd exhaustion.

## Risks this week
- **Scanner buffer**: default `bufio.Scanner` chokes on long JSONL lines → silent
  truncation. Set a large buffer (above).
- **rjeczalik/notify recursion glob**: it's `path/...`, not `path/**`. Wrong glob = no events.
- **Emit before frontend ready**: `ServiceStartup` runs before the window mounts, so a
  `file-change` fired immediately is lost (no replay). Gate the first flush on a frontend
  "ready" event, or have the UI request initial state. `application.Get()` is valid once
  `application.New` has run.
- **Spotlight/duplicate events**: FSEvents coalesces; the 100ms debounce + path-keyed
  map dedups. Keep the map keyed by path.
