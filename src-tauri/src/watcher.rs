use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::event::EventKind;
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Mirrors the TypeScript `FileChangeEvent` from `src/main/types/chunks.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// "add" | "change" | "unlink"
    #[serde(rename = "type")]
    pub change_type: String,
    /// Absolute path to the changed file
    pub path: String,
    /// Encoded project directory name (e.g., "-Users-name-project")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Session UUID (filename without extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Whether this is a subagent file
    pub is_subagent: bool,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct WatcherState {
    debouncer: Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>,
    watching: bool,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            debouncer: None,
            watching: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Path parsing
// ---------------------------------------------------------------------------

/// Map notify event kinds to our change type strings.
fn map_event_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("add"),
        EventKind::Modify(_) => Some("change"),
        EventKind::Remove(_) => Some("unlink"),
        _ => None,
    }
}

/// Parse a projects-directory file path into a FileChangeEvent.
///
/// Expected structures:
///   projectId/sessionId.jsonl                          → session file
///   projectId/sessionId/subagents/agent-hash.jsonl     → subagent file
fn parse_project_file(
    projects_path: &Path,
    file_path: &Path,
    change_type: &str,
) -> Option<FileChangeEvent> {
    let relative = file_path.strip_prefix(projects_path).ok()?;
    let components: Vec<&str> = relative
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    // Must end with .jsonl
    let filename = components.last()?;
    if !filename.ends_with(".jsonl") {
        return None;
    }

    let project_id = components.first()?.to_string();

    let (session_id, is_subagent) = match components.len() {
        // projectId/sessionId.jsonl
        2 => {
            let sid = filename.strip_suffix(".jsonl")?.to_string();
            (Some(sid), false)
        }
        // projectId/sessionId/subagents/agent-hash.jsonl
        4 if components[2] == "subagents" => {
            let sid = components[1].to_string();
            (Some(sid), true)
        }
        _ => return None,
    };

    Some(FileChangeEvent {
        change_type: change_type.to_string(),
        path: file_path.to_string_lossy().to_string(),
        project_id: Some(project_id),
        session_id,
        is_subagent,
    })
}

/// Parse a todos-directory file path into a FileChangeEvent.
///
/// Expected structure: sessionId.json
fn parse_todo_file(
    todos_path: &Path,
    file_path: &Path,
    change_type: &str,
) -> Option<FileChangeEvent> {
    let relative = file_path.strip_prefix(todos_path).ok()?;
    let filename = relative.to_str()?;

    if !filename.ends_with(".json") {
        return None;
    }

    let session_id = filename.strip_suffix(".json")?.to_string();

    Some(FileChangeEvent {
        change_type: change_type.to_string(),
        path: file_path.to_string_lossy().to_string(),
        project_id: None,
        session_id: Some(session_id),
        is_subagent: false,
    })
}

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
pub fn start_watcher(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<WatcherState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    if guard.watching {
        return Ok(());
    }

    let claude_dir = resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_path = claude_dir.join("projects");
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
                                                    eprintln!("[watcher] Error detection failed: {e}");
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
                        eprintln!("[watcher] Error: {err:?}");
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
        eprintln!(
            "[watcher] Watching projects: {}",
            projects_path.display()
        );
    } else {
        eprintln!(
            "[watcher] Projects dir does not exist yet: {}",
            projects_path.display()
        );
    }

    // Watch todos directory non-recursively (flat dir of {sessionId}.json)
    if todos_path.exists() {
        debouncer
            .watch(&todos_path, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch todos: {e}"))?;
        eprintln!("[watcher] Watching todos: {}", todos_path.display());
    } else {
        eprintln!(
            "[watcher] Todos dir does not exist yet: {}",
            todos_path.display()
        );
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

    eprintln!("[watcher] Stopped file watching");
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
                    eprintln!(
                        "[watcher] Retry: now watching projects: {}",
                        projects_path.display()
                    );
                    need_projects = false;
                }
            }

            if need_todos && todos_path.exists() {
                if debouncer
                    .watch(&todos_path, RecursiveMode::NonRecursive)
                    .is_ok()
                {
                    eprintln!(
                        "[watcher] Retry: now watching todos: {}",
                        todos_path.display()
                    );
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_parse_project_file_session() {
        let projects = Path::new("/home/user/.claude/projects");
        let file = Path::new("/home/user/.claude/projects/-Users-name-project/abc123.jsonl");
        let event = parse_project_file(projects, file, "change").unwrap();
        assert_eq!(event.project_id, Some("-Users-name-project".to_string()));
        assert_eq!(event.session_id, Some("abc123".to_string()));
        assert!(!event.is_subagent);
        assert_eq!(event.change_type, "change");
    }

    #[test]
    fn test_parse_project_file_subagent() {
        let projects = Path::new("/home/user/.claude/projects");
        let file = Path::new(
            "/home/user/.claude/projects/-Users-name-project/abc123/subagents/agent-def456.jsonl",
        );
        let event = parse_project_file(projects, file, "add").unwrap();
        assert_eq!(event.project_id, Some("-Users-name-project".to_string()));
        assert_eq!(event.session_id, Some("abc123".to_string()));
        assert!(event.is_subagent);
        assert_eq!(event.change_type, "add");
    }

    #[test]
    fn test_parse_project_file_ignores_non_jsonl() {
        let projects = Path::new("/home/user/.claude/projects");
        let file = Path::new("/home/user/.claude/projects/-Users-name-project/README.md");
        assert!(parse_project_file(projects, file, "change").is_none());
    }

    #[test]
    fn test_parse_project_file_ignores_wrong_depth() {
        let projects = Path::new("/home/user/.claude/projects");
        // Only 1 component (project dir itself, no file)
        let file = Path::new("/home/user/.claude/projects/-Users-name-project");
        assert!(parse_project_file(projects, file, "change").is_none());
    }

    #[test]
    fn test_parse_project_file_ignores_3_components() {
        let projects = Path::new("/home/user/.claude/projects");
        // 3 components but not a subagent structure
        let file =
            Path::new("/home/user/.claude/projects/-Users-name-project/abc123/random.jsonl");
        assert!(parse_project_file(projects, file, "change").is_none());
    }

    #[test]
    fn test_parse_todo_file() {
        let todos = Path::new("/home/user/.claude/todos");
        let file = Path::new("/home/user/.claude/todos/abc123.json");
        let event = parse_todo_file(todos, file, "change").unwrap();
        assert_eq!(event.session_id, Some("abc123".to_string()));
        assert!(event.project_id.is_none());
        assert!(!event.is_subagent);
        assert_eq!(event.change_type, "change");
    }

    #[test]
    fn test_parse_todo_file_ignores_non_json() {
        let todos = Path::new("/home/user/.claude/todos");
        let file = Path::new("/home/user/.claude/todos/abc123.txt");
        assert!(parse_todo_file(todos, file, "change").is_none());
    }

    #[test]
    fn test_parse_todo_file_unlink() {
        let todos = Path::new("/home/user/.claude/todos");
        let file = Path::new("/home/user/.claude/todos/session-uuid.json");
        let event = parse_todo_file(todos, file, "unlink").unwrap();
        assert_eq!(event.session_id, Some("session-uuid".to_string()));
        assert_eq!(event.change_type, "unlink");
    }

    #[test]
    fn test_map_event_kind_create() {
        assert_eq!(
            map_event_kind(&EventKind::Create(notify::event::CreateKind::File)),
            Some("add")
        );
    }

    #[test]
    fn test_map_event_kind_modify() {
        assert_eq!(
            map_event_kind(&EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Content
            ))),
            Some("change")
        );
    }

    #[test]
    fn test_map_event_kind_remove() {
        assert_eq!(
            map_event_kind(&EventKind::Remove(notify::event::RemoveKind::File)),
            Some("unlink")
        );
    }

    #[test]
    fn test_map_event_kind_access_returns_none() {
        assert_eq!(
            map_event_kind(&EventKind::Access(notify::event::AccessKind::Read)),
            None
        );
    }
}
