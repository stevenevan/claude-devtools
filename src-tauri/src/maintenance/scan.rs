//! Ported from `internal/maintenance/scan.go` (W13). One `DirUsage` row per
//! immediate child of each root, Bytes/Files aggregated recursively per child.
//!
//! Security invariants (reproduced guard-for-guard): sizes come from Lstat
//! (`symlink_metadata` / `DirEntry::metadata`, which never follow a symlink) —
//! never a following stat, never `EvalSymlinks`. An entry that is itself a
//! symlink is flagged and never opened/read, making the walk symlink-cycle-safe.
//! Only child symlinks are refused; the root's own final component is followed
//! (we intentionally scan whatever the configured root points at).

use std::fs::{self, DirEntry};
use std::path::Path;

use chrono::{DateTime, Utc};

use super::category::{mtime_utc, read_dir_sorted};
use super::types::{go_zero_time, DirUsage};

/// How often (in directories visited) the walk calls the progress callback. The
/// service further time-throttles before emitting an event.
const SCAN_PROGRESS_INTERVAL: usize = 64;
/// Caps recursion into a pathologically deep tree. Real `~/.claude` trees never
/// approach this. Shared with the bounded category walks.
pub(crate) const MAX_SCAN_DEPTH: usize = 64;

/// Progress sink: `(dirs_visited, bytes_so_far)`. The service wires the event;
/// `None` disables progress reporting.
pub type Progress<'a> = Option<&'a dyn Fn(usize, i64)>;

/// Returns one `DirUsage` row per immediate child of each root, with Bytes/Files
/// aggregated recursively per child. Mirrors Go `ScanClaudeDir`.
pub fn scan_claude_dir(roots: &[String], progress: Progress<'_>) -> Result<Vec<DirUsage>, String> {
    let mut out: Vec<DirUsage> = Vec::new();
    let mut dirs_visited = 0usize;
    let mut bytes_so_far = 0i64;

    for root in roots {
        validate_root(root)?;
        let root_path = Path::new(root);
        let entries = read_dir_sorted(root_path);
        // read_dir_sorted swallows the read error; re-surface it like Go, which
        // aborts the whole scan on a root that cannot be read.
        if entries.is_empty() && fs::read_dir(root_path).is_err() {
            return Err(format!("maintenance: read root {root:?}"));
        }
        for entry in entries {
            let child_path = entry.path();
            out.push(scan_child(
                &child_path,
                &entry,
                &mut dirs_visited,
                &mut bytes_so_far,
                progress,
            ));
        }
    }
    Ok(out)
}

/// Fails fast on a missing/non-directory root rather than launching a whole-FS
/// walk on a corrupt config. Mirrors Go `validateRoot`. The root's final
/// component IS followed (a following `stat`), matching Go.
fn validate_root(root: &str) -> Result<(), String> {
    let info = fs::metadata(root).map_err(|e| format!("maintenance: root {root:?}: {e}"))?;
    if !info.is_dir() {
        return Err(format!("maintenance: root {root:?} is not a directory"));
    }
    Ok(())
}

/// Classifies one immediate child of a root and, if it is a real directory,
/// recursively aggregates its subtree. Mirrors Go `scanChild`.
fn scan_child(
    child_path: &Path,
    entry: &DirEntry,
    dirs_visited: &mut usize,
    bytes_so_far: &mut i64,
    progress: Progress<'_>,
) -> DirUsage {
    let info = match entry.metadata() {
        Ok(m) => m,
        Err(e) => return err_usage(child_path, &e.to_string()),
    };
    let path = child_path.to_string_lossy().into_owned();

    if info.file_type().is_symlink() {
        return DirUsage {
            path,
            bytes: 0,
            files: 0,
            mod_time: mtime_utc(&info),
            is_symlink: true,
            err: String::new(),
        };
    }
    if !info.is_dir() {
        return DirUsage {
            path,
            bytes: info.len() as i64,
            files: 1,
            mod_time: mtime_utc(&info),
            is_symlink: false,
            err: String::new(),
        };
    }
    walk_child_dir(child_path, mtime_utc(&info), dirs_visited, bytes_so_far, progress)
}

/// Recursively aggregates one child directory's subtree. Per-entry errors are
/// captured on `DirUsage.err` instead of aborting. Mirrors Go `walkChildDir`.
fn walk_child_dir(
    child_path: &Path,
    mod_time: DateTime<Utc>,
    dirs_visited: &mut usize,
    bytes_so_far: &mut i64,
    progress: Progress<'_>,
) -> DirUsage {
    let mut usage = DirUsage {
        path: child_path.to_string_lossy().into_owned(),
        bytes: 0,
        files: 0,
        mod_time,
        is_symlink: false,
        err: String::new(),
    };
    walk_dir_entries(child_path, child_path, &mut usage, dirs_visited, bytes_so_far, progress);
    usage
}

fn walk_dir_entries(
    dir: &Path,
    child_root: &Path,
    usage: &mut DirUsage,
    dirs_visited: &mut usize,
    bytes_so_far: &mut i64,
    progress: Progress<'_>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            record_err(usage, &e.to_string());
            return;
        }
    };
    let mut sorted: Vec<DirEntry> = Vec::new();
    for entry in entries {
        match entry {
            Ok(e) => sorted.push(e),
            Err(e) => record_err(usage, &e.to_string()),
        }
    }
    sorted.sort_by_key(|e| e.file_name());

    for entry in sorted {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(e) => {
                record_err(usage, &e.to_string());
                continue;
            }
        };
        if file_type.is_symlink() {
            continue; // flagged only at the immediate-child level; never traversed
        }
        if file_type.is_dir() {
            if visit_dir(child_root, &path, dirs_visited, bytes_so_far, progress) {
                walk_dir_entries(&path, child_root, usage, dirs_visited, bytes_so_far, progress);
            }
            continue;
        }
        visit_file(&entry, usage, bytes_so_far);
    }
}

fn record_err(usage: &mut DirUsage, err: &str) {
    if usage.err.is_empty() {
        usage.err = err.to_string();
    }
}

/// Returns whether the directory should be descended (false = depth-capped,
/// `SkipDir`). Mirrors Go `visitDir`.
fn visit_dir(
    child_root: &Path,
    path: &Path,
    dirs_visited: &mut usize,
    bytes_so_far: &mut i64,
    progress: Progress<'_>,
) -> bool {
    // Go counts path separators in the relative path (`strings.Count(rel, sep)`);
    // a relative path of N components has N-1 separators.
    if let Ok(rel) = path.strip_prefix(child_root) {
        if rel.components().count().saturating_sub(1) > MAX_SCAN_DEPTH {
            return false;
        }
    }
    *dirs_visited += 1;
    if let Some(cb) = progress {
        if *dirs_visited % SCAN_PROGRESS_INTERVAL == 0 {
            cb(*dirs_visited, *bytes_so_far);
        }
    }
    true
}

fn visit_file(entry: &DirEntry, usage: &mut DirUsage, bytes_so_far: &mut i64) {
    let info = match entry.metadata() {
        Ok(m) => m,
        Err(e) => {
            record_err(usage, &e.to_string());
            return;
        }
    };
    usage.bytes += info.len() as i64;
    usage.files += 1;
    *bytes_so_far += info.len() as i64;
}

fn err_usage(child_path: &Path, err: &str) -> DirUsage {
    DirUsage {
        path: child_path.to_string_lossy().into_owned(),
        bytes: 0,
        files: 0,
        mod_time: go_zero_time(),
        is_symlink: false,
        err: err.to_string(),
    }
}

#[cfg(test)]
#[path = "scan_tests.rs"]
mod scan_tests;
