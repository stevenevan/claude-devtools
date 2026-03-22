/// TriggerTester — tests triggers against historical session data.

use std::path::Path;
use std::time::Instant;

use crate::config::types::NotificationTrigger;
use crate::discovery::{path_decoder, project_scanner, subproject_registry::SubprojectRegistry};
use crate::parsing::session_parser;
use crate::watcher;

use super::error_detector::detect_errors_with_trigger;
use super::types::{DetectedError, TriggerTestResult};

// Safety limits
const MAX_ERRORS: usize = 50;
const MAX_TOTAL_COUNT: usize = 10_000;
const TIMEOUT_MS: u128 = 30_000;

struct TestState {
    errors: Vec<DetectedError>,
    total_count: usize,
    truncated: bool,
    start_time: Instant,
    effective_limit: usize,
}

impl TestState {
    fn should_stop(&self) -> bool {
        if self.errors.len() >= self.effective_limit {
            return true;
        }
        if self.start_time.elapsed().as_millis() > TIMEOUT_MS {
            return true;
        }
        if self.total_count >= MAX_TOTAL_COUNT {
            return true;
        }
        false
    }

    fn is_safety_limit(&self) -> bool {
        self.start_time.elapsed().as_millis() > TIMEOUT_MS
            || self.total_count >= MAX_TOTAL_COUNT
    }
}

/// Test a trigger against historical sessions. Returns matched errors with safety limits.
pub fn test_trigger(
    trigger: &NotificationTrigger,
    limit: Option<usize>,
) -> TriggerTestResult {
    let effective_limit = limit.unwrap_or(MAX_ERRORS).min(MAX_ERRORS);

    let mut state = TestState {
        errors: Vec::new(),
        total_count: 0,
        truncated: false,
        start_time: Instant::now(),
        effective_limit,
    };

    let claude_dir = match watcher::resolve_claude_dir() {
        Some(d) => d,
        None => {
            return TriggerTestResult {
                total_count: 0,
                errors: vec![],
                truncated: None,
            };
        }
    };

    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let mut registry = SubprojectRegistry::new();

    let projects = match project_scanner::scan_projects(&projects_dir, &mut registry) {
        Ok(p) => p,
        Err(_) => {
            return TriggerTestResult {
                total_count: 0,
                errors: vec![],
                truncated: None,
            };
        }
    };

    'outer: for project in &projects {
        if state.should_stop() {
            if state.is_safety_limit() {
                state.truncated = true;
            }
            break;
        }

        // List session files for this project
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

            // Parse session file
            let parsed = match session_parser::parse_session_file(file_path) {
                Ok(p) => p,
                Err(_) => continue,
            };

            let session_id = file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            let file_path_str = file_path.to_string_lossy().to_string();

            let session_errors = detect_errors_with_trigger(
                &parsed.messages,
                trigger,
                &session_id,
                &project.id,
                &file_path_str,
            );

            let new_total = state.total_count + session_errors.len();
            if new_total >= MAX_TOTAL_COUNT {
                state.total_count = MAX_TOTAL_COUNT;
                state.truncated = true;
            } else {
                state.total_count = new_total;
            }

            for error in session_errors {
                if state.errors.len() >= state.effective_limit {
                    break;
                }
                state.errors.push(error);
            }
        }
    }

    TriggerTestResult {
        total_count: state.total_count,
        errors: state.errors,
        truncated: if state.truncated { Some(true) } else { None },
    }
}

/// List .jsonl files in a project directory.
fn list_jsonl_files(dir: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut files: Vec<std::path::PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .collect();
    // Sort newest first (by modified time)
    files.sort_by(|a, b| {
        let ma = a.metadata().and_then(|m| m.modified()).ok();
        let mb = b.metadata().and_then(|m| m.modified()).ok();
        mb.cmp(&ma)
    });
    Ok(files)
}
