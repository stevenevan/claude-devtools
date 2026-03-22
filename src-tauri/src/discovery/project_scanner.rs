/// Project scanning — discover projects from ~/.claude/projects/.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::types::domain::Project;
use crate::types::jsonl::RawJsonlEntry;

use super::content_filter::has_non_noise_messages;
use super::path_decoder::{decode_path, extract_project_name, is_valid_encoded_path};
use super::subproject_registry::SubprojectRegistry;

/// Scan the projects directory and return all projects.
pub fn scan_projects(
    projects_dir: &Path,
    registry: &mut SubprojectRegistry,
) -> Result<Vec<Project>, String> {
    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    registry.clear();
    let mut all_projects = Vec::new();

    let entries = std::fs::read_dir(projects_dir)
        .map_err(|e| format!("Failed to read projects dir: {e}"))?;

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy().to_string();

        if !entry.path().is_dir() || !is_valid_encoded_path(&name) {
            continue;
        }

        match scan_project(projects_dir, &name, registry) {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                eprintln!("[scanner] Error scanning project {name}: {e}");
            }
        }
    }

    // Sort by most recent session (descending)
    all_projects.sort_by(|a, b| {
        let a_time = a.most_recent_session.unwrap_or(0.0);
        let b_time = b.most_recent_session.unwrap_or(0.0);
        b_time.partial_cmp(&a_time).unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(all_projects)
}

/// Scan a single project directory. May return multiple projects if
/// sessions have different `cwd` values (subproject splitting).
fn scan_project(
    projects_dir: &Path,
    encoded_name: &str,
    registry: &mut SubprojectRegistry,
) -> Result<Vec<Project>, String> {
    let project_dir = projects_dir.join(encoded_name);
    let entries = std::fs::read_dir(&project_dir)
        .map_err(|e| format!("Failed to read {}: {e}", project_dir.display()))?;

    // Collect session files with their cwds
    let mut sessions_by_cwd: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    let mut default_cwd: Option<String> = None;

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if !file_name.ends_with(".jsonl") || file_name.starts_with("agent_") {
            continue;
        }

        let session_id = file_name.trim_end_matches(".jsonl").to_string();
        let file_path = entry.path();

        // Get file creation time for sorting
        let created_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.created().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);

        // Extract cwd from the first line of the session file
        let cwd = extract_cwd_from_file(&file_path).unwrap_or_default();

        if default_cwd.is_none() && !cwd.is_empty() {
            default_cwd = Some(cwd.clone());
        }

        let key = if cwd.is_empty() {
            "__default__".to_string()
        } else {
            cwd
        };

        sessions_by_cwd
            .entry(key)
            .or_default()
            .push((session_id, created_at));
    }

    // If all sessions have the same cwd (or only one group), return one project
    if sessions_by_cwd.len() <= 1 {
        let (cwd, sessions) = sessions_by_cwd
            .into_iter()
            .next()
            .unwrap_or(("__default__".to_string(), vec![]));

        let cwd_hint = if cwd == "__default__" {
            default_cwd.as_deref()
        } else {
            Some(cwd.as_str())
        };

        let session_ids: Vec<String> = sessions.iter().map(|(id, _)| id.clone()).collect();
        let most_recent = sessions.iter().map(|(_, t)| *t).fold(0.0f64, f64::max);
        let created_at = sessions.iter().map(|(_, t)| *t).fold(f64::MAX, f64::min);

        return Ok(vec![Project {
            id: encoded_name.to_string(),
            path: cwd_hint
                .map(|s| s.to_string())
                .unwrap_or_else(|| decode_path(encoded_name)),
            name: extract_project_name(encoded_name, cwd_hint),
            sessions: session_ids,
            created_at: if created_at == f64::MAX { 0.0 } else { created_at },
            most_recent_session: if most_recent > 0.0 {
                Some(most_recent)
            } else {
                None
            },
        }]);
    }

    // Multiple cwds → create composite projects
    let mut projects = Vec::new();

    for (cwd, sessions) in sessions_by_cwd {
        let cwd_str = if cwd == "__default__" {
            default_cwd.as_deref().unwrap_or("")
        } else {
            &cwd
        };

        let session_ids: Vec<String> = sessions.iter().map(|(id, _)| id.clone()).collect();
        let most_recent = sessions.iter().map(|(_, t)| *t).fold(0.0f64, f64::max);
        let created_at = sessions.iter().map(|(_, t)| *t).fold(f64::MAX, f64::min);

        let composite_id = registry.register(encoded_name, cwd_str, session_ids.clone());

        projects.push(Project {
            id: composite_id,
            path: cwd_str.to_string(),
            name: extract_project_name(encoded_name, Some(cwd_str)),
            sessions: session_ids,
            created_at: if created_at == f64::MAX { 0.0 } else { created_at },
            most_recent_session: if most_recent > 0.0 {
                Some(most_recent)
            } else {
                None
            },
        });
    }

    Ok(projects)
}

/// Extract the `cwd` field from the first line of a JSONL file.
fn extract_cwd_from_file(file_path: &Path) -> Option<String> {
    let file = std::fs::File::open(file_path).ok()?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line.ok()?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<RawJsonlEntry>(&line) {
            if let Some(cwd) = entry.cwd {
                if !cwd.is_empty() {
                    return Some(cwd);
                }
            }
        }
        // Only check the first non-empty line
        break;
    }

    None
}
