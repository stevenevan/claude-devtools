/// Locate subagent JSONL files for a session.
///
/// Supports two directory structures:
/// NEW: {projectId}/{sessionId}/subagents/agent_*.jsonl
/// OLD: {projectId}/agent_*.jsonl

use std::path::Path;

pub fn has_subagents(projects_dir: &Path, project_id: &str, session_id: &str) -> bool {
    let base_dir = super::path_decoder::extract_base_dir(project_id);

    // Check new structure first
    let new_path = projects_dir
        .join(base_dir)
        .join(session_id)
        .join("subagents");
    if new_path.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&new_path) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.ends_with(".jsonl") {
                    return true;
                }
            }
        }
    }

    // Check old structure: agent_*.jsonl at project root
    let project_dir = projects_dir.join(base_dir);
    if let Ok(entries) = std::fs::read_dir(&project_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("agent_") && name.ends_with(".jsonl") {
                return true;
            }
        }
    }

    false
}
