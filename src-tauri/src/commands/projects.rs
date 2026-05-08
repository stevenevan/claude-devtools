use std::sync::{Arc, Mutex};

use crate::discovery::{path_decoder, project_scanner, subproject_registry::SubprojectRegistry};
use crate::types::domain::Project;
use crate::watcher;

#[tauri::command]
pub fn get_projects(
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<Vec<Project>, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);

    let mut registry = registry.lock().map_err(|e| e.to_string())?;
    project_scanner::scan_projects(&projects_dir, &mut registry)
}
