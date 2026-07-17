//! Ported from `internal/maintenance/category.go` (W13). Go self-registers each
//! matcher via `init()`; Rust has no `init()`, so `scan_category` is an explicit
//! dispatch over all 18 leaf ids and `cutoff_default` returns each id's built-in
//! age cutoff. The shared matcher helpers (`open_dir_no_symlink`,
//! `subtree_stats`, `older_than`, `is_today`) are ported verbatim, preserving the
//! symlink-refusal + no-follow + age-gate invariants.

use std::fs::{self, DirEntry, Metadata};
use std::path::Path;

use chrono::{DateTime, Local, Utc};

use super::types::{go_zero_time, Candidate, CategorySpec};
use super::{
    cat_backups, cat_caches, cat_filehistory, cat_junk, cat_logs, cat_plans, cat_plugins,
    cat_projects, cat_runtime, cat_transcripts,
};

/// Dispatches to the matcher for `spec.id`. An unknown id is an error, not an
/// empty result — the service only ever passes ids it exposes, so an unknown id
/// means a wiring bug. Mirrors Go `ScanCategory`.
pub fn scan_category(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    match spec.id.as_str() {
        "junk-dsstore" => cat_junk::scan_junk_dsstore(spec),
        "junk-tmp" => cat_junk::scan_junk_tmp(spec),
        "junk-emptydirs" => cat_junk::scan_junk_empty_dirs(spec),
        "plugins" => cat_plugins::scan_plugins(spec),
        "runtime-tasks" => cat_runtime::scan_runtime_tasks(spec),
        "runtime-tasks-empty" => cat_runtime::scan_runtime_tasks_empty(spec),
        "runtime-jobs" => cat_runtime::scan_runtime_jobs(spec),
        "runtime-sessions" => cat_runtime::scan_runtime_sessions(spec),
        "runtime-session-env" => cat_runtime::scan_runtime_session_env(spec),
        "runtime-shell-snapshots" => cat_runtime::scan_runtime_shell_snapshots(spec),
        "projects" => cat_projects::scan_projects(spec),
        "backup-binaries" => cat_backups::scan_backup_binaries(spec),
        "caches" => cat_caches::scan_caches(spec),
        "logs" => cat_logs::scan_logs(spec),
        "logs-daemon" => cat_logs::scan_logs_daemon(spec),
        "file-history" => cat_filehistory::scan_file_history(spec),
        "plans" => cat_plans::scan_plans(spec),
        "transcripts" => cat_transcripts::scan_transcripts(spec),
        other => Err(format!("maintenance: unknown category {other:?}")),
    }
}

/// A category's built-in cutoff (days); 0 = no age gate. An unknown id yields 0,
/// matching Go's zero-value `registered` lookup. Mirrors Go `CutoffDefault`.
pub fn cutoff_default(id: &str) -> i64 {
    match id {
        "junk-tmp" => 1,
        "runtime-tasks" => 7,
        "runtime-tasks-empty" => 2,
        "runtime-jobs" => 7,
        "runtime-sessions" => 7,
        "runtime-session-env" => 7,
        "runtime-shell-snapshots" => 7,
        "projects" => 90,
        "file-history" => 30,
        "plans" => 60,
        "transcripts" => 90,
        // junk-dsstore, junk-emptydirs, plugins, backup-binaries, caches, logs,
        // logs-daemon, and unknown ids: no age gate.
        _ => 0,
    }
}

// ─── shared matcher helpers ──────────────────────────────────────────────────

/// Lstats `dir` and refuses to enumerate it if it is a symlink, mirroring the
/// scan's child-symlink-refused invariant. A missing dir yields `(vec![],
/// false)` — the category simply has zero candidates. Entries are returned
/// sorted by name to match Go's `os.ReadDir`. Mirrors Go `openDirNoSymlink`.
pub(crate) fn open_dir_no_symlink(dir: &Path) -> Result<(Vec<DirEntry>, bool), String> {
    let info = match fs::symlink_metadata(dir) {
        Ok(info) => info,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((Vec::new(), false)),
        Err(e) => return Err(format!("maintenance: lstat {}: {e}", dir.display())),
    };
    if info.file_type().is_symlink() || !info.is_dir() {
        return Ok((Vec::new(), false));
    }
    let mut entries: Vec<DirEntry> = fs::read_dir(dir)
        .map_err(|e| format!("maintenance: read dir {}: {e}", dir.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("maintenance: read dir {}: {e}", dir.display()))?;
    entries.sort_by_key(|e| e.file_name());
    Ok((entries, true))
}

/// Reads a directory's entries sorted by name, swallowing read errors (yields an
/// empty list) — used by the top-down bounded walks, which "skip unreadable
/// entries, keep walking the rest".
pub(crate) fn read_dir_sorted(dir: &Path) -> Vec<DirEntry> {
    let mut entries: Vec<DirEntry> = match fs::read_dir(dir) {
        Ok(rd) => rd.flatten().collect(),
        Err(_) => return Vec::new(),
    };
    entries.sort_by_key(|e| e.file_name());
    entries
}

/// Aggregates a directory subtree the same way the disk scan does: Lstat only,
/// symlinks contribute zero bytes and are never traversed. Returns total bytes,
/// file count, and the newest file/dir mtime seen (the "last used" age-based
/// matchers rely on). Mirrors Go `subtreeStats`.
pub(crate) fn subtree_stats(root: &Path) -> (i64, i64, DateTime<Utc>) {
    let mut bytes = 0i64;
    let mut files = 0i64;
    let mut newest = go_zero_time();
    accumulate_subtree(root, &mut bytes, &mut files, &mut newest);
    (bytes, files, newest)
}

fn accumulate_subtree(path: &Path, bytes: &mut i64, files: &mut i64, newest: &mut DateTime<Utc>) {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return, // skip unreadable entries, keep aggregating the rest
    };
    if meta.file_type().is_symlink() {
        return; // never follow; contributes 0 bytes like the disk scan
    }
    let mtime = mtime_utc(&meta);
    if mtime > *newest {
        *newest = mtime;
    }
    if meta.is_dir() {
        for entry in read_dir_sorted(path) {
            accumulate_subtree(&entry.path(), bytes, files, newest);
        }
        return;
    }
    *bytes += meta.len() as i64;
    *files += 1;
}

/// Reports whether `t` falls on the same calendar day as `now`, in local time —
/// the live-session guard: anything touched today is never a candidate. Both
/// instants are compared in the local zone, matching Go's `t.In(now.Location())`
/// where `now` is `time.Now()` (Local). Mirrors Go `isToday`.
pub(crate) fn is_today(t: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    t.with_timezone(&Local).date_naive() == now.with_timezone(&Local).date_naive()
}

/// The age gate every age-based matcher shares: strictly older than the cutoff
/// AND not modified today. `None` cutoff = no age gate (still excludes today).
/// Mirrors Go `olderThan`.
pub(crate) fn older_than(mtime: DateTime<Utc>, spec: &CategorySpec) -> bool {
    if is_today(mtime, spec.now) {
        return false;
    }
    match spec.cutoff {
        None => true,
        Some(cutoff) => mtime < cutoff,
    }
}

/// The modification time of `meta` as UTC.
pub(crate) fn mtime_utc(meta: &Metadata) -> DateTime<Utc> {
    match meta.modified() {
        Ok(t) => DateTime::<Utc>::from(t),
        Err(_) => go_zero_time(),
    }
}

/// Go `boolStr` — `"true"`/`"false"`.
pub(crate) fn bool_str(b: bool) -> &'static str {
    if b {
        "true"
    } else {
        "false"
    }
}

/// Lexical equality of two paths (component-wise), mirroring `filepath.Clean(a)
/// == filepath.Clean(b)` for the app-data exclusion. No symlink resolution — the
/// clean paths here never contain `..`.
pub(crate) fn same_path(a: &Path, b: &Path) -> bool {
    a.components().eq(b.components())
}

#[cfg(test)]
#[path = "maint_test_support.rs"]
pub(crate) mod maint_test_support;

#[cfg(test)]
#[path = "category_tests.rs"]
mod category_tests;
