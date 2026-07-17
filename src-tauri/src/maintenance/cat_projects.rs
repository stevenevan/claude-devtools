//! Ported from `internal/maintenance/cat_projects.go` (W13). Surfaces old
//! session JSONL under `<root>/projects` (the app's own input store). One
//! candidate per session file older than the cutoff (default 90d), grouped by
//! the decoded human-readable project path, carrying the REAL composite
//! `domain.Project.ID`. Pinned sessions are flagged; today's are never
//! candidates.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::discovery::path_decoder::decode_path;
use crate::discovery::project_scanner::scan_projects as discovery_scan_projects;
use crate::discovery::subproject_registry::SubprojectRegistry;

use super::category::{mtime_utc, older_than, open_dir_no_symlink};
use super::types::{Candidate, CategorySpec};

pub fn scan_projects(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let projects_dir = Path::new(&spec.root).join("projects");
    let (encoded, ok) = open_dir_no_symlink(&projects_dir)?;
    if !ok {
        return Ok(Vec::new());
    }

    let session_project = resolve_session_projects(&projects_dir);
    let pinned: HashSet<&str> = spec.pinned.iter().map(String::as_str).collect();

    let mut out: Vec<Candidate> = Vec::new();
    for proj_entry in &encoded {
        if !proj_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let enc = proj_entry.file_name().to_string_lossy().into_owned();
        let proj_dir = projects_dir.join(&enc);
        let decoded = decode_path(&enc);

        let (sessions, ok) = open_dir_no_symlink(&proj_dir)?;
        if !ok {
            continue;
        }
        for s in &sessions {
            let s_name = s.file_name().to_string_lossy().into_owned();
            let is_dir = s.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir || !s_name.ends_with(".jsonl") {
                continue;
            }
            let Ok(info) = s.metadata() else {
                continue;
            };
            if info.file_type().is_symlink() {
                continue;
            }
            let mtime = mtime_utc(&info);
            if !older_than(mtime, spec) {
                continue;
            }
            let sid = s_name.trim_end_matches(".jsonl").to_string();
            let project_id = session_project.get(&sid).cloned().unwrap_or_else(|| enc.clone());

            let mut meta = std::collections::BTreeMap::new();
            meta.insert("encoded".to_string(), enc.clone());
            meta.insert("project".to_string(), decoded.clone());
            meta.insert("sessionId".to_string(), sid.clone());
            meta.insert("projectId".to_string(), project_id);
            if pinned.contains(sid.as_str()) {
                meta.insert("pinned".to_string(), "true".to_string());
            }
            out.push(Candidate {
                path: proj_dir.join(&s_name).to_string_lossy().into_owned(),
                bytes: info.len() as i64,
                files: 1,
                mod_time: mtime,
                reason: "old session".to_string(),
                group: decoded.clone(),
                meta,
            });
        }
    }
    Ok(out)
}

/// Maps sessionID → real `domain.Project.ID` via the discovery scanner
/// (composite-id aware). Best-effort: a scan error yields an empty map and the
/// caller falls back to the encoded dir name. Mirrors Go `resolveSessionProjects`.
fn resolve_session_projects(projects_dir: &Path) -> HashMap<String, String> {
    let mut registry = SubprojectRegistry::new();
    let projects = match discovery_scan_projects(projects_dir, &mut registry) {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    let mut m = HashMap::new();
    for p in projects {
        let id = p.id;
        for sid in p.sessions {
            m.insert(sid, id.clone());
        }
    }
    m
}

#[cfg(test)]
#[path = "cat_projects_tests.rs"]
mod cat_projects_tests;
