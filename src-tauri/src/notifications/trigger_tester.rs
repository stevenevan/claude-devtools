//! `trigger_tester` — tests a trigger against all historical sessions with
//! safety limits. Ported from `internal/notifications/trigger_tester.go` (W14).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use crate::config::state::types::NotificationTrigger;
use crate::discovery::path_decoder::get_projects_base_path;
use crate::discovery::project_scanner::scan_projects;
use crate::discovery::subproject_registry::SubprojectRegistry;
use crate::parsing::session_parser::parse_jsonl_file;
use crate::watcher::resolve_claude_dir;

use super::error_detector::detect_errors_with_trigger;
use super::types::{DetectedError, TriggerTestResult};

const MAX_ERRORS: usize = 50;
const MAX_TOTAL_COUNT: usize = 10_000;
const TIMEOUT: Duration = Duration::from_secs(30);

struct TestState {
    errors: Vec<DetectedError>,
    total_count: usize,
    truncated: bool,
    start_time: Instant,
    effective_limit: usize,
}

impl TestState {
    fn should_stop(&self) -> bool {
        self.errors.len() >= self.effective_limit
            || self.start_time.elapsed() > TIMEOUT
            || self.total_count >= MAX_TOTAL_COUNT
    }

    fn is_safety_limit(&self) -> bool {
        self.start_time.elapsed() > TIMEOUT || self.total_count >= MAX_TOTAL_COUNT
    }
}

fn empty_result() -> TriggerTestResult {
    TriggerTestResult {
        total_count: 0,
        errors: Vec::new(),
        truncated: None,
    }
}

/// Tests a trigger against all historical session data with hard safety limits
/// (50 errors or caller `limit`, 10k total scanned, 30s wall clock).
pub fn test_trigger(trigger: &NotificationTrigger, limit: Option<usize>) -> TriggerTestResult {
    let effective_limit = match limit {
        Some(l) if l < MAX_ERRORS => l,
        _ => MAX_ERRORS,
    };

    let mut state = TestState {
        errors: Vec::new(),
        total_count: 0,
        truncated: false,
        start_time: Instant::now(),
        effective_limit,
    };

    let claude_dir = match resolve_claude_dir() {
        Some(dir) => dir,
        None => return empty_result(),
    };

    let projects_dir = get_projects_base_path(&claude_dir);
    let mut registry = SubprojectRegistry::new();
    let projects = match scan_projects(&projects_dir, &mut registry) {
        Ok(p) => p,
        Err(_) => return empty_result(),
    };

    'outer: for project in &projects {
        if state.should_stop() {
            if state.is_safety_limit() {
                state.truncated = true;
            }
            break;
        }

        let project_dir = projects_dir.join(&project.id);
        let session_files = match list_jsonl_files(&project_dir) {
            Ok(f) => f,
            Err(_) => continue,
        };

        for file_path in &session_files {
            if state.should_stop() {
                if state.is_safety_limit() {
                    state.truncated = true;
                }
                break 'outer;
            }

            let messages = match parse_jsonl_file(file_path) {
                Ok((msgs, _)) => msgs,
                Err(_) => continue,
            };

            let session_id = file_path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();

            let session_errors = detect_errors_with_trigger(
                &messages,
                trigger,
                &session_id,
                &project.id,
                &file_path.to_string_lossy(),
            );

            let new_total = state.total_count + session_errors.len();
            if new_total >= MAX_TOTAL_COUNT {
                state.total_count = MAX_TOTAL_COUNT;
                state.truncated = true;
            } else {
                state.total_count = new_total;
            }

            for e in session_errors {
                if state.errors.len() >= state.effective_limit {
                    break;
                }
                state.errors.push(e);
            }
        }
    }

    TriggerTestResult {
        total_count: state.total_count as i64,
        errors: state.errors,
        truncated: if state.truncated { Some(true) } else { None },
    }
}

/// Returns `.jsonl` files in `dir`, sorted newest-first by mtime.
fn list_jsonl_files(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_dir() || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let mtime = match entry.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        files.push((path, mtime));
    }

    files.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(files.into_iter().map(|(p, _)| p).collect())
}

#[cfg(test)]
#[path = "trigger_tester_tests.rs"]
mod tests;
