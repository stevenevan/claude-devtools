//! Ported from `internal/maintenance/cat_logs.go` (W13). `logs` (devtools log
//! files under `<root>/logs`) and `logs-daemon` (`daemon.log` + rotated
//! `daemon.log.N` at the root, TRUNCATE-cleared). No age gate.

use std::collections::BTreeMap;
use std::path::Path;

use super::category::{mtime_utc, open_dir_no_symlink};
use super::types::{Candidate, CategorySpec};

/// Lists devtools log files under `<root>/logs`. Mirrors Go `scanLogs`.
pub fn scan_logs(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let dir = Path::new(&spec.root).join("logs");
    let (entries, ok) = open_dir_no_symlink(&dir)?;
    if !ok {
        return Ok(Vec::new());
    }
    let mut out: Vec<Candidate> = Vec::new();
    for e in &entries {
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(info) = e.metadata() else {
            continue;
        };
        if info.file_type().is_symlink() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let mut meta = BTreeMap::new();
        meta.insert("owner".to_string(), "app".to_string());
        out.push(Candidate {
            path: dir.join(&name).to_string_lossy().into_owned(),
            bytes: info.len() as i64,
            files: 1,
            mod_time: mtime_utc(&info),
            reason: "devtools log file".to_string(),
            group: String::new(),
            meta,
        });
    }
    Ok(out)
}

/// Lists the CLI daemon log (+ rotated `daemon.log.N`) at the root. Mirrors Go
/// `scanLogsDaemon`.
pub fn scan_logs_daemon(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let root = Path::new(&spec.root);
    let (entries, ok) = open_dir_no_symlink(root)?;
    if !ok {
        return Ok(Vec::new());
    }
    let mut out: Vec<Candidate> = Vec::new();
    for e in &entries {
        let name = e.file_name().to_string_lossy().into_owned();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir || (name != "daemon.log" && !name.starts_with("daemon.log.")) {
            continue;
        }
        let Ok(info) = e.metadata() else {
            continue;
        };
        if info.file_type().is_symlink() {
            continue;
        }
        let mut meta = BTreeMap::new();
        meta.insert("owner".to_string(), "daemon".to_string());
        out.push(Candidate {
            path: root.join(&name).to_string_lossy().into_owned(),
            bytes: info.len() as i64,
            files: 1,
            mod_time: mtime_utc(&info),
            reason: "CLI daemon log (cleared by truncate)".to_string(),
            group: String::new(),
            meta,
        });
    }
    Ok(out)
}
