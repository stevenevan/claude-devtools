//! Ported from `internal/maintenance/cat_runtime.go` (W13). The six W11
//! runtime-state families, all backed by one per-entry age-gate scanner: each
//! entry directly under `<root>/<subdir>`, older than the cutoff, optionally
//! excluding one protected name and/or narrowed by a marker-only predicate.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use super::category::{mtime_utc, older_than, open_dir_no_symlink, read_dir_sorted, subtree_stats};
use super::types::{Candidate, CategorySpec};

/// Decides whether one subdir entry belongs to a runtime family, independent of
/// age. `marker_only` is only meaningful for dirs. Mirrors Go `runtimeEntryFilter`.
type RuntimeEntryFilter<'a> = Option<&'a dyn Fn(bool, bool) -> bool>;

/// Shared per-entry age-gate scanner behind all six runtime families. A dir
/// entry's age is its newest descendant (`subtree_stats`); a file entry's age is
/// its own mtime; today's mtime is never a candidate. Mirrors Go
/// `scanRuntimeSubdir`.
fn scan_runtime_subdir(
    spec: &CategorySpec,
    subdir: &str,
    reason: &str,
    protected_name: &str,
    filter: RuntimeEntryFilter<'_>,
) -> Result<Vec<Candidate>, String> {
    let dir = Path::new(&spec.root).join(subdir);
    let (entries, ok) = open_dir_no_symlink(&dir)?;
    if !ok {
        return Ok(Vec::new());
    }

    let mut out: Vec<Candidate> = Vec::new();
    for e in &entries {
        let name = e.file_name().to_string_lossy().into_owned();
        if !protected_name.is_empty() && name == protected_name {
            continue;
        }
        let path = dir.join(&name);
        let Ok(file_type) = e.file_type() else {
            continue;
        };

        let (bytes, files, mtime, is_dir, marker_only) = if file_type.is_dir() {
            let (bytes, files, mtime) = subtree_stats(&path);
            (bytes, files, mtime, true, is_marker_only_dir(&path))
        } else {
            let Ok(meta) = e.metadata() else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            (meta.len() as i64, 1, mtime_utc(&meta), false, false)
        };

        if let Some(filt) = filter {
            if !filt(is_dir, marker_only) {
                continue;
            }
        }
        if !older_than(mtime, spec) {
            continue;
        }
        out.push(Candidate {
            path: path.to_string_lossy().into_owned(),
            bytes,
            files,
            mod_time: mtime,
            reason: reason.to_string(),
            group: String::new(),
            meta: BTreeMap::new(),
        });
    }
    Ok(out)
}

/// Whether `dir`'s subtree holds only the CLI's `.lock`/`.highwatermark`
/// bookkeeping (or nothing). Mirrors Go `isMarkerOnlyDir`.
fn is_marker_only_dir(dir: &Path) -> bool {
    let mut marker_only = true;
    check_marker_only(dir, &mut marker_only);
    marker_only
}

fn check_marker_only(path: &Path, marker_only: &mut bool) {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };
    if meta.file_type().is_symlink() {
        return;
    }
    if meta.is_dir() {
        for entry in read_dir_sorted(path) {
            check_marker_only(&entry.path(), marker_only);
        }
        return;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name != ".lock" && name != ".highwatermark" {
        *marker_only = false;
    }
}

/// Per-UUID dirs under `tasks/` holding real (dead) task state. Mirrors Go
/// `scanRuntimeTasks`.
pub fn scan_runtime_tasks(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    scan_runtime_subdir(spec, "tasks", "dead task state", "", Some(&|is_dir, marker_only| {
        is_dir && !marker_only
    }))
}

/// Marker-only (or truly empty) per-UUID dirs under `tasks/`. Mirrors Go
/// `scanRuntimeTasksEmpty`.
pub fn scan_runtime_tasks_empty(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    scan_runtime_subdir(spec, "tasks", "empty task markers", "", Some(&|is_dir, marker_only| {
        is_dir && marker_only
    }))
}

/// Stale entries under `jobs/`, except `pins.json`. Mirrors Go `scanRuntimeJobs`.
pub fn scan_runtime_jobs(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    scan_runtime_subdir(spec, "jobs", "old job", "pins.json", None)
}

/// Stale per-file entries under `sessions/`. Mirrors Go `scanRuntimeSessions`.
pub fn scan_runtime_sessions(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    scan_runtime_subdir(spec, "sessions", "stale session state", "", None)
}

/// Stale per-file entries under `session-env/`. Mirrors Go `scanRuntimeSessionEnv`.
pub fn scan_runtime_session_env(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    scan_runtime_subdir(spec, "session-env", "stale session environment", "", None)
}

/// Stale per-file entries under `shell-snapshots/`. Mirrors Go
/// `scanRuntimeShellSnapshots`.
pub fn scan_runtime_shell_snapshots(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    scan_runtime_subdir(spec, "shell-snapshots", "stale shell snapshot", "", None)
}

#[cfg(test)]
#[path = "cat_runtime_tests.rs"]
mod cat_runtime_tests;
