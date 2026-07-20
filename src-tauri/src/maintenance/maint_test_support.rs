//! Test-only support shared by the maintenance matcher tests. Every test runs
//! against a fresh unique temp dir (NEVER the real `~/.claude`) and backdates
//! file/dir mtimes via `touch -t` (the crate has no `filetime` dep). Times are
//! anchored at a fixed local noon so the local-calendar-day age gate is
//! deterministic regardless of the machine clock.

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::{DateTime, Local, TimeZone};

/// A unique temp directory, recursively removed on drop.
pub struct TempDir {
    pub path: PathBuf,
}

impl TempDir {
    pub fn new(prefix: &str) -> Self {
        let unique = format!("maint-{prefix}-{}", uuid::Uuid::new_v4());
        let path = std::env::temp_dir().join(unique);
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// Fixed anchor `now`, local noon on 2026-07-10 (matches the Go tests).
pub fn test_now() -> DateTime<Local> {
    Local.with_ymd_and_hms(2026, 7, 10, 12, 0, 0).unwrap()
}

/// `t` minus `days` days (local wall clock preserved).
pub fn days_before(t: DateTime<Local>, days: i64) -> DateTime<Local> {
    t - chrono::Duration::days(days)
}

/// Creates parent dirs as needed and writes `content`.
pub fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dir");
    }
    fs::write(path, content).expect("write file");
}

/// Sets the atime+mtime of an existing path to `t` (local), via `touch -t`.
pub fn set_mtime(path: &Path, t: DateTime<Local>) {
    let stamp = t.format("%Y%m%d%H%M.%S").to_string();
    let status = Command::new("touch")
        .arg("-t")
        .arg(&stamp)
        .arg(path)
        .status()
        .expect("run touch");
    assert!(status.success(), "touch failed for {}", path.display());
}

/// Writes a file then backdates its mtime to `t`, returning the path as a String.
pub fn write_aged(path: &Path, content: &str, t: DateTime<Local>) -> String {
    write_file(path, content);
    set_mtime(path, t);
    path.to_string_lossy().into_owned()
}
