//! File watcher (W10). Ports Go `internal/watcher` (runner/parsers/types) to Rust.
//!
//! No Tauri import here: the caller injects `emit_fn`. The 100 ms per-path
//! debounce is hand-rolled (std threads + timers) to match Go `runner.go`
//! `schedule()`'s id-supersession exactly — NOT delegated to a debouncer crate.

mod parsers;
mod types;

#[cfg(test)]
mod tests;

pub use parsers::resolve_claude_dir;
pub use types::FileChangeEvent;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};

use parsers::{map_event_kind, parse_project_file, parse_todo_file};

/// Per-path debounce window. Matches Go `debounceDuration` (100 ms).
const DEBOUNCE_MS: u64 = 100;
/// Poll interval for directories missing at Start. Matches Go `retryInterval` (2 s).
const RETRY_MS: u64 = 2000;

/// Injected emit sink. Mirrors Go `emitFn func(event string, payload any)`; the
/// payload is a pre-serialized `serde_json::Value` so this module stays UI-agnostic.
pub type EmitFn = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// One in-flight debounce timer for a path. `id` allows a timer to detect that a
/// newer event superseded it (mirrors Go `pendingItem.id`).
struct PendingItem {
    id: u64,
    kind: &'static str,
}

/// Scheduler state guarded by one mutex (mirrors Go's `r.mu` over pending+idGen).
struct SchedulerState {
    pending: HashMap<PathBuf, PendingItem>,
    id_gen: u64,
}

/// Shared, thread-owned watcher context. Cloned via Arc into the drain, retry,
/// and per-path timer threads.
struct WatchContext {
    projects_dir: PathBuf,
    todos_dir: PathBuf,
    // None = disabled (Go's empty-string configDir/claudeJSONDir).
    config_dir: Option<PathBuf>,
    claude_json_dir: Option<PathBuf>,
    emit_fn: EmitFn,
    state: Mutex<SchedulerState>,
    running: AtomicBool,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

/// Manages recursive/non-recursive filesystem watches. Mirrors Go `watcher.Runner`.
pub struct Runner {
    ctx: Arc<WatchContext>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

fn opt_dir(dir: &str) -> Option<PathBuf> {
    if dir.is_empty() {
        None
    } else {
        Some(PathBuf::from(dir))
    }
}

impl Runner {
    /// Mirrors Go `watcher.New`. `config_dir`/`claude_json_dir` empty = disabled.
    pub fn new<F>(
        projects_dir: &str,
        todos_dir: &str,
        config_dir: &str,
        claude_json_dir: &str,
        emit_fn: F,
    ) -> Self
    where
        F: Fn(&str, Value) + Send + Sync + 'static,
    {
        Runner {
            ctx: Arc::new(WatchContext {
                projects_dir: PathBuf::from(projects_dir),
                todos_dir: PathBuf::from(todos_dir),
                config_dir: opt_dir(config_dir),
                claude_json_dir: opt_dir(claude_json_dir),
                emit_fn: Arc::new(emit_fn),
                state: Mutex::new(SchedulerState {
                    pending: HashMap::new(),
                    id_gen: 0,
                }),
                running: AtomicBool::new(false),
                watcher: Mutex::new(None),
            }),
            threads: Mutex::new(Vec::new()),
        }
    }

    /// Start watching. Idempotent (mirrors Go `Start`). Missing dirs retried every 2 s.
    pub fn start(&self) -> Result<(), String> {
        if self.ctx.running.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
        let watcher = notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .map_err(|e| format!("failed to create watcher: {e}"))?;
        *self.ctx.watcher.lock().unwrap() = Some(watcher);

        let need_projects = !self.ctx.watch_projects();
        let need_todos = !self.ctx.watch_todos();
        let need_config = !self.ctx.watch_config();
        let need_claude = !self.ctx.watch_claude_json();

        let drain_ctx = Arc::clone(&self.ctx);
        let drain_handle = thread::spawn(move || drain(drain_ctx, rx));
        self.threads.lock().unwrap().push(drain_handle);

        if need_projects || need_todos || need_config || need_claude {
            let retry_ctx = Arc::clone(&self.ctx);
            let retry_handle = thread::spawn(move || {
                retry_watch(retry_ctx, need_projects, need_todos, need_config, need_claude)
            });
            self.threads.lock().unwrap().push(retry_handle);
        }

        Ok(())
    }

    /// Stop all watching and join background threads. Safe to call repeatedly.
    /// Mirrors Go `Stop` (running=false, clear pending timers, drop watcher, wait).
    pub fn stop(&self) {
        if !self.ctx.running.swap(false, Ordering::SeqCst) {
            return;
        }
        self.ctx.state.lock().unwrap().pending.clear();
        // Dropping the watcher stops FS events and closes the channel → drain exits.
        *self.ctx.watcher.lock().unwrap() = None;

        let handles: Vec<_> = self.threads.lock().unwrap().drain(..).collect();
        for handle in handles {
            let _ = handle.join();
        }
    }
}

impl WatchContext {
    fn watch_projects(&self) -> bool {
        self.watch_dir(Some(&self.projects_dir), RecursiveMode::Recursive)
    }

    fn watch_todos(&self) -> bool {
        self.watch_dir(Some(&self.todos_dir), RecursiveMode::NonRecursive)
    }

    fn watch_config(&self) -> bool {
        self.watch_dir(self.config_dir.as_deref(), RecursiveMode::NonRecursive)
    }

    fn watch_claude_json(&self) -> bool {
        self.watch_dir(self.claude_json_dir.as_deref(), RecursiveMode::NonRecursive)
    }

    /// Register one watch. `None` dir = intentionally disabled → true (Go returns
    /// true for an empty configDir). Missing dir or watch error → false (retry).
    fn watch_dir(&self, dir: Option<&Path>, mode: RecursiveMode) -> bool {
        let Some(dir) = dir else {
            return true;
        };
        if !dir.exists() {
            return false;
        }
        match self.watcher.lock().unwrap().as_mut() {
            Some(w) => w.watch(dir, mode).is_ok(),
            None => false,
        }
    }

    /// Classify a debounced event and emit. Called outside all locks. Routing is
    /// identical to Go `processEvent` (runner.go).
    fn process_event(&self, path: &Path, kind: &'static str) {
        if is_under(&self.projects_dir, path) {
            if let Some(evt) = parse_project_file(&self.projects_dir, path, kind) {
                self.emit("file-change", to_value(&evt));
            }
        } else if is_under(&self.todos_dir, path) {
            if let Some(evt) = parse_todo_file(&self.todos_dir, path, kind) {
                self.emit("todo-change", to_value(&evt));
            }
        } else if basename_matches(self.config_dir.as_deref(), path, "settings.json") {
            self.emit("config-file-change", config_payload(path, kind));
        } else if basename_matches(self.claude_json_dir.as_deref(), path, ".claude.json") {
            self.emit("config-file-change", config_payload(path, kind));
        }
    }

    fn emit(&self, event: &str, payload: Value) {
        (self.emit_fn)(event, payload);
    }
}

/// Debounce an event: path-keyed, coalescing bursts within 100 ms. Mirrors Go
/// `schedule` — each event bumps a monotone id; a per-path timer fires after
/// 100 ms and emits only if its id still matches (else it was superseded).
fn schedule(ctx: &Arc<WatchContext>, path: PathBuf, kind: &'static str) {
    let my_id = {
        let mut state = ctx.state.lock().unwrap();
        state.id_gen += 1;
        let id = state.id_gen;
        state.pending.insert(path.clone(), PendingItem { id, kind });
        id
    };

    let timer_ctx = Arc::clone(ctx);
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(DEBOUNCE_MS));
        let actual_kind = {
            let mut state = timer_ctx.state.lock().unwrap();
            match state.pending.get(&path) {
                Some(item) if item.id == my_id => {
                    let kind = item.kind;
                    state.pending.remove(&path);
                    kind
                }
                // Superseded by a newer event, or cleared by Stop → bail.
                _ => return,
            }
        };
        timer_ctx.process_event(&path, actual_kind);
    });
}

/// Read events until the channel disconnects (watcher dropped on Stop). Mirrors
/// Go `drain`. Errors are dropped-and-continued (Go logs slog.Warn).
fn drain(ctx: Arc<WatchContext>, rx: std::sync::mpsc::Receiver<notify::Result<Event>>) {
    for res in rx {
        let Ok(event) = res else {
            continue;
        };
        let Some(kind) = map_event_kind(&event.kind) else {
            continue;
        };
        for path in event.paths {
            schedule(&ctx, path, kind);
        }
    }
}

/// Poll every 2 s for directories missing at Start. Mirrors Go `retryWatch`.
fn retry_watch(
    ctx: Arc<WatchContext>,
    mut need_projects: bool,
    mut need_todos: bool,
    mut need_config: bool,
    mut need_claude: bool,
) {
    loop {
        // Sleep RETRY_MS in short chunks so Stop is observed promptly.
        let mut slept = 0;
        while slept < RETRY_MS {
            if !ctx.running.load(Ordering::SeqCst) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
            slept += 50;
        }
        if !ctx.running.load(Ordering::SeqCst) {
            return;
        }
        if need_projects && ctx.watch_projects() {
            need_projects = false;
        }
        if need_todos && ctx.watch_todos() {
            need_todos = false;
        }
        if need_config && ctx.watch_config() {
            need_config = false;
        }
        if need_claude && ctx.watch_claude_json() {
            need_claude = false;
        }
        if !need_projects && !need_todos && !need_config && !need_claude {
            return;
        }
    }
}

/// Reports whether `child` is strictly inside `parent`. Mirrors Go `isUnder`
/// (rel != "." && !strings.HasPrefix(rel, "..")).
fn is_under(parent: &Path, child: &Path) -> bool {
    match child.strip_prefix(parent) {
        Ok(rel) => !rel.as_os_str().is_empty(),
        Err(_) => false,
    }
}

/// True when `dir` is set and `path` is `dir/<basename>`. Mirrors Go's
/// `configDir != "" && filepath.Dir(path) == configDir && filepath.Base(path) == basename`.
fn basename_matches(dir: Option<&Path>, path: &Path, basename: &str) -> bool {
    match dir {
        Some(dir) => {
            path.parent() == Some(dir) && path.file_name() == Some(basename.as_ref())
        }
        None => false,
    }
}

fn config_payload(path: &Path, kind: &str) -> Value {
    json!({ "path": path.to_string_lossy(), "kind": kind })
}

fn to_value(evt: &FileChangeEvent) -> Value {
    serde_json::to_value(evt).unwrap_or(Value::Null)
}
