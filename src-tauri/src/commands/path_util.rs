use std::path::PathBuf;

pub fn resolve_session_path(project_id: &str, session_id: &str) -> Result<PathBuf, String> {
    let claude_dir = crate::watcher::resolve_claude_dir()
        .ok_or("Cannot resolve home directory")?;

    let base_dir = if let Some(idx) = project_id.find("::") {
        &project_id[..idx]
    } else {
        project_id
    };

    let path = claude_dir
        .join("projects")
        .join(base_dir)
        .join(format!("{session_id}.jsonl"));

    Ok(path)
}
