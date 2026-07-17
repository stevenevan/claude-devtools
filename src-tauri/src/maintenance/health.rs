//! Ports `internal/maintenance/health.go` — the READ-ONLY health snapshot for
//! the maintenance panel. No side effects: missing files yield zero/absent
//! states, never errors. Reads `.last-cleanup`, `.last-update-result.json`, the
//! tail of `daemon.log`, and the known mode-flag dotfiles (an allowlist, never a
//! raw dotfile enumeration). Guards reproduced verbatim (invariant #3).

use std::fs::{self, File, Metadata};
use std::os::unix::fs::FileExt;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

/// Caps how much of the tail of daemon.log is read — the last N lines come from
/// this window, never the whole file. Mirrors `daemonTailBytes`/`daemonTailLines`.
const DAEMON_TAIL_BYTES: u64 = 64 << 10;
const DAEMON_TAIL_LINES: usize = 40;

/// Allowlist of mode-flag dotfiles the health panel shows. Mirrors
/// `knownFlagFiles`.
const KNOWN_FLAG_FILES: [&str; 2] = [".caveman-active", ".ponytail-active"];

/// One known mode-flag dotfile's presence + content. Mirrors `FlagFile`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlagFile {
    pub name: String,
    pub present: bool,
    pub content: String,
}

/// The read-only health snapshot. Times are file mtimes (ms). Mirrors
/// `HealthStatus`. `scheduler_interval` + `last_auto_cleanup_ms` are the in-app
/// scheduler status the SERVICE layer populates from config — this pure reader
/// leaves them zero-valued (settable, but never set here).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    pub last_cleanup_ms: f64,
    pub last_cleanup_raw: String,
    pub last_update_raw: String,
    pub last_update_status: String,
    pub last_update_version: String,
    pub last_update_parse_err: bool,
    pub daemon_present: bool,
    pub daemon_last_write_ms: f64,
    pub daemon_tail: Vec<String>,
    pub flags: Vec<FlagFile>,
    pub scheduler_interval: String,
    pub last_auto_cleanup_ms: f64,
}

/// Reads the four health surfaces read-only (no side effects). Missing files
/// yield zero/absent states, never errors. Mirrors `MaintenanceHealth`.
pub fn maintenance_health(root: &str) -> Result<HealthStatus, String> {
    let mut h = HealthStatus::default();
    let root = Path::new(root);

    // .last-cleanup: mtime + trimmed raw content.
    let last_cleanup = root.join(".last-cleanup");
    if let Ok(meta) = fs::symlink_metadata(&last_cleanup) {
        if !meta.is_dir() {
            h.last_cleanup_ms = mtime_ms(&meta);
            if let Ok(data) = fs::read(&last_cleanup) {
                h.last_cleanup_raw = trimmed(&data);
            }
        }
    }

    // .last-update-result.json: raw + parsed {status, version}; parse failure is
    // a flag, not fatal.
    if let Ok(data) = fs::read(root.join(".last-update-result.json")) {
        h.last_update_raw = trimmed(&data);
        #[derive(Deserialize)]
        struct Parsed {
            #[serde(default)]
            status: String,
            #[serde(default)]
            version: String,
        }
        match serde_json::from_slice::<Parsed>(&data) {
            Ok(p) => {
                h.last_update_status = p.status;
                h.last_update_version = p.version;
            }
            Err(_) => h.last_update_parse_err = true,
        }
    }

    // daemon.log: present + mtime + last-N-lines tail. A symlink is refused.
    let daemon_path = root.join("daemon.log");
    if let Ok(meta) = fs::symlink_metadata(&daemon_path) {
        if !meta.is_dir() && !meta.file_type().is_symlink() {
            h.daemon_present = true;
            h.daemon_last_write_ms = mtime_ms(&meta);
            h.daemon_tail = tail_lines(&daemon_path, meta.len());
        }
    }

    // Known flag dotfiles: always listed (present=false when absent).
    for name in KNOWN_FLAG_FILES {
        let mut flag = FlagFile {
            name: name.to_string(),
            present: false,
            content: String::new(),
        };
        if let Ok(data) = fs::read(root.join(name)) {
            flag.present = true;
            flag.content = trimmed(&data);
        }
        h.flags.push(flag);
    }

    Ok(h)
}

/// Returns the last `DAEMON_TAIL_LINES` lines of path, reading only the final
/// `DAEMON_TAIL_BYTES` window. Mirrors `tailLines`.
fn tail_lines(path: &Path, size: u64) -> Vec<String> {
    let Ok(f) = File::open(path) else {
        return Vec::new();
    };

    let mut read_len = DAEMON_TAIL_BYTES;
    let mut offset = 0u64;
    if size > read_len {
        offset = size - read_len;
    } else {
        read_len = size;
    }

    let mut buf = vec![0u8; read_len as usize];
    // Sized to exactly the available bytes, so a full read is expected; any
    // error (mirroring Go's non-EOF bail) yields an empty tail.
    if f.read_exact_at(&mut buf, offset).is_err() {
        return Vec::new();
    }

    let text = String::from_utf8_lossy(&buf);
    let trimmed_text = text.trim_end_matches('\n');
    let mut lines: Vec<String> = trimmed_text.split('\n').map(|s| s.to_string()).collect();
    if offset > 0 && !lines.is_empty() {
        lines.remove(0); // drop the partial first line from mid-file
    }
    if lines.len() > DAEMON_TAIL_LINES {
        lines = lines[lines.len() - DAEMON_TAIL_LINES..].to_vec();
    }
    lines
}

/// File mtime in epoch-ms as a float. Mirrors `info.ModTime().UnixMilli()`.
fn mtime_ms(meta: &Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Trims surrounding ASCII whitespace, matching Go's `strings.TrimSpace` for the
/// common cases (space/tab/newline/CR).
fn trimmed(data: &[u8]) -> String {
    String::from_utf8_lossy(data).trim().to_string()
}

#[cfg(test)]
#[path = "health_tests.rs"]
mod health_tests;
