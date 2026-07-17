use std::path::{Path, PathBuf};

use notify::event::{EventKind, ModifyKind};

use super::types::FileChangeEvent;

/// Map a notify v7 `EventKind` to our change-type string, reproducing Go
/// `MapEventKind` (internal/watcher/parsers.go)'s four outcomes exactly:
///
/// | Go (rjeczalik/notify) | outcome  | notify v7 arm                    |
/// |-----------------------|----------|----------------------------------|
/// | Create                | "add"    | `Create(_)`                      |
/// | Write                 | "change" | `Modify(Data(_))` / `Modify(Any)`|
/// | Remove                | "unlink" | `Remove(_)`                      |
/// | Rename                | "unlink" | `Modify(Name(_))`                |
/// | (default)             | None     | everything else                  |
///
/// notify v7 models a content write as `Modify(Data)` (and, when FSEvents
/// coalesces, `Modify(Any)`), and a rename as `Modify(Name)` — so the Name arm
/// is checked BEFORE the write arms. `Modify(Metadata)` (chmod) is intentionally
/// dropped: Go's portable Event set has no chmod flag, so it maps to None.
pub(crate) fn map_event_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("add"),
        EventKind::Modify(ModifyKind::Name(_)) => Some("unlink"),
        EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Any) => {
            Some("change")
        }
        EventKind::Remove(_) => Some("unlink"),
        _ => None,
    }
}

/// Parse a projects-directory file path into a FileChangeEvent, reconciled with
/// Go `ParseProjectFile`.
///
/// Structures (relative to projects_dir):
///   projectId/sessionId.jsonl                        → session file
///   projectId/sessionId/subagents/agent-hash.jsonl   → subagent file
pub(crate) fn parse_project_file(
    projects_dir: &Path,
    file_path: &Path,
    change_type: &str,
) -> Option<FileChangeEvent> {
    // strip_prefix is component-based: a non-descendant (Go's rel starting with
    // "..") returns Err, and file_path == projects_dir (Go's rel == ".") yields
    // an empty remainder → no last component → None below.
    let relative = file_path.strip_prefix(projects_dir).ok()?;
    let components: Vec<&str> = relative
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    let filename = components.last()?;
    if !filename.ends_with(".jsonl") {
        return None;
    }

    let project_id = components.first()?.to_string();

    let (session_id, is_subagent) = match components.len() {
        2 => (filename.strip_suffix(".jsonl")?.to_string(), false),
        4 if components[2] == "subagents" => (components[1].to_string(), true),
        _ => return None,
    };

    Some(FileChangeEvent {
        change_type: change_type.to_string(),
        path: file_path.to_string_lossy().to_string(),
        project_id: Some(project_id),
        session_id: Some(session_id),
        is_subagent,
    })
}

/// Parse a todos-directory file path into a FileChangeEvent, reconciled with Go
/// `ParseTodoFile`. Structure: sessionId.json (flat, non-recursive). No projectId.
pub(crate) fn parse_todo_file(
    todos_dir: &Path,
    file_path: &Path,
    change_type: &str,
) -> Option<FileChangeEvent> {
    let relative = file_path.strip_prefix(todos_dir).ok()?;
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

/// Resolve the .claude root, mirroring Go `ResolveClaudeDir`: honour `CLAUDE_ROOT`
/// when it points at an existing path, else fall back to `$HOME/.claude`.
#[cfg_attr(not(test), allow(dead_code))]
pub fn resolve_claude_dir() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("CLAUDE_ROOT") {
        let p = PathBuf::from(root);
        if p.exists() {
            return Some(p);
        }
    }
    dirs::home_dir().map(|h| h.join(".claude"))
}
