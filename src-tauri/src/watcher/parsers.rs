use std::path::Path;

use notify::event::EventKind;

use super::types::FileChangeEvent;

/// Map notify event kinds to our change type strings.
pub(crate) fn map_event_kind(kind: &EventKind) -> Option<&'static str> {
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
pub(crate) fn parse_project_file(
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
pub(crate) fn parse_todo_file(
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
