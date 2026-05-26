use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent};
use tauri::{AppHandle, Emitter, Manager};

use super::parsers::{map_event_kind, parse_project_file, parse_todo_file};
use super::types::WatcherState;

// ---------------------------------------------------------------------------
// Resolve claude base directory
// ---------------------------------------------------------------------------

pub fn resolve_claude_dir() -> Option<PathBuf> {
    // Respect CLAUDE_ROOT env var (same as the TypeScript sidecar)
    if let Ok(root) = std::env::var("CLAUDE_ROOT") {
        let p = PathBuf::from(root);
        if p.exists() {
            return Some(p);
        }
    }
    dirs::home_dir().map(|h| h.join(".claude"))
}

// ---------------------------------------------------------------------------
// Watcher lifecycle
// ---------------------------------------------------------------------------

/// Start watching `~/.claude/projects/` and `~/.claude/todos/`.
///
/// Sprint 64: `projects_path` is sourced from the startup-captured canonical
/// `ClaudeRoot` (managed state). The `todos_path` derivation still uses
/// `resolve_claude_dir()` because todos live one level up and have no
/// user-controlled join — a symlink swap there cannot widen the IPC trust
/// boundary the watcher exposes.
pub fn start_watcher(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<WatcherState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    if guard.watching {
        return Ok(());
    }

    let claude_root = app.state::<crate::commands::claude_root::ClaudeRoot>();
    let projects_path = claude_root.canonical_projects().to_path_buf();
    let claude_dir = resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let todos_path = claude_dir.join("todos");

    let app_handle = app.clone();
    let projects_clone = projects_path.clone();
    let todos_clone = todos_path.clone();

    // 100ms debounce matches the TypeScript DEBOUNCE_MS constant
    let mut debouncer = new_debouncer(
        Duration::from_millis(100),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            match result {
                Ok(events) => {
                    for event in events {
                        let change_type = match map_event_kind(&event.kind) {
                            Some(t) => t,
                            None => continue,
                        };

                        for path in &event.paths {
                            if path.starts_with(&projects_clone) {
                                if let Some(evt) =
                                    parse_project_file(&projects_clone, path, change_type)
                                {
                                    let _ = app_handle.emit("file-change", &evt);

                                    // Trigger error detection for changed JSONL files
                                    if (change_type == "add" || change_type == "change")
                                        && !evt.is_subagent
                                    {
                                        if let (Some(ref pid), Some(ref sid)) =
                                            (&evt.project_id, &evt.session_id)
                                        {
                                            let handle = app_handle.clone();
                                            let fp = evt.path.clone();
                                            let pid = pid.clone();
                                            let sid = sid.clone();
                                            std::thread::spawn(move || {
                                                if let Err(e) = crate::notifications::commands::detect_and_notify(
                                                    &handle, &fp, &pid, &sid,
                                                ) {
                                                    tracing::warn!(target: "watcher", error = %e, "error detection failed");
                                                }
                                            });
                                        }
                                    }
                                }
                            } else if path.starts_with(&todos_clone) {
                                if let Some(evt) =
                                    parse_todo_file(&todos_clone, path, change_type)
                                {
                                    let _ = app_handle.emit("todo-change", &evt);
                                }
                            }
                        }
                    }
                }
                Err(errors) => {
                    for err in errors {
                        tracing::warn!(target: "watcher", error = ?err, "watcher event error");
                    }
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create debouncer: {e}"))?;

    // Watch projects directory recursively (needed for subagent subdirs)
    if projects_path.exists() {
        debouncer
            .watch(&projects_path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch projects: {e}"))?;
        tracing::info!(target: "watcher", path = %crate::logging::Redact(projects_path.as_path()), "watching projects");
    } else {
        tracing::warn!(target: "watcher", path = %crate::logging::Redact(projects_path.as_path()), "projects dir missing — will retry");
    }

    // Watch todos directory non-recursively (flat dir of {sessionId}.json)
    if todos_path.exists() {
        debouncer
            .watch(&todos_path, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch todos: {e}"))?;
        tracing::info!(target: "watcher", path = %crate::logging::Redact(todos_path.as_path()), "watching todos");
    } else {
        tracing::warn!(target: "watcher", path = %crate::logging::Redact(todos_path.as_path()), "todos dir missing — will retry");
    }

    guard.debouncer = Some(debouncer);
    guard.watching = true;

    // Spawn retry thread for directories that don't exist yet
    let needs_projects_retry = !projects_path.exists();
    let needs_todos_retry = !todos_path.exists();

    if needs_projects_retry || needs_todos_retry {
        let retry_handle = app.clone();
        let retry_projects = projects_path;
        let retry_todos = todos_path;
        std::thread::spawn(move || {
            retry_watch(
                retry_handle,
                retry_projects,
                retry_todos,
                needs_projects_retry,
                needs_todos_retry,
            );
        });
    }

    Ok(())
}

/// Stop watching and clean up.
pub fn stop_watcher(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<WatcherState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    // Dropping the debouncer stops all watchers
    guard.debouncer = None;
    guard.watching = false;

    tracing::info!(target: "watcher", "stopped file watching");
    Ok(())
}

// ---------------------------------------------------------------------------
// Retry logic for missing directories
// ---------------------------------------------------------------------------

/// Retry adding watches for directories that didn't exist at startup.
/// Matches the TypeScript WATCHER_RETRY_MS = 2000.
fn retry_watch(
    app_handle: AppHandle,
    projects_path: PathBuf,
    todos_path: PathBuf,
    mut need_projects: bool,
    mut need_todos: bool,
) {
    loop {
        std::thread::sleep(Duration::from_millis(2000));

        let state = app_handle.state::<Mutex<WatcherState>>();
        let mut guard = match state.lock() {
            Ok(g) => g,
            Err(_) => break,
        };

        if !guard.watching {
            break;
        }

        if let Some(ref mut debouncer) = guard.debouncer {
            if need_projects && projects_path.exists() {
                if debouncer
                    .watch(&projects_path, RecursiveMode::Recursive)
                    .is_ok()
                {
                    tracing::info!(target: "watcher", path = %crate::logging::Redact(projects_path.as_path()), "retry succeeded for projects");
                    need_projects = false;
                }
            }

            if need_todos && todos_path.exists() {
                if debouncer
                    .watch(&todos_path, RecursiveMode::NonRecursive)
                    .is_ok()
                {
                    tracing::info!(target: "watcher", path = %crate::logging::Redact(todos_path.as_path()), "retry succeeded for todos");
                    need_todos = false;
                }
            }

            if !need_projects && !need_todos {
                break;
            }
        } else {
            break;
        }
    }
}
