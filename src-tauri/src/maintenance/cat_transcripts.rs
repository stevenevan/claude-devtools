//! Ported from `internal/maintenance/cat_transcripts.go` (W13). Surfaces stale
//! transcript files under `<root>/transcripts` (flat machine-generated logs the
//! CLI never prunes). Candidates are files older than the cutoff (default 90d),
//! grouped by the local month they were last written (lexical `YYYY-MM`).

use std::collections::BTreeMap;
use std::path::Path;

use chrono::Local;

use super::category::{mtime_utc, older_than, open_dir_no_symlink};
use super::types::{Candidate, CategorySpec};

pub fn scan_transcripts(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let dir = Path::new(&spec.root).join("transcripts");
    let (entries, ok) = open_dir_no_symlink(&dir)?;
    if !ok {
        return Ok(Vec::new());
    }

    let mut out: Vec<Candidate> = Vec::new();
    for e in &entries {
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue; // transcripts are flat files
        }
        let Ok(info) = e.metadata() else {
            continue;
        };
        if info.file_type().is_symlink() {
            continue;
        }
        let mtime = mtime_utc(&info);
        if !older_than(mtime, spec) {
            continue;
        }
        // Go formats the local `time.Time` with layout "2006-01" (year-month).
        let group = mtime.with_timezone(&Local).format("%Y-%m").to_string();
        let name = e.file_name().to_string_lossy().into_owned();
        out.push(Candidate {
            path: dir.join(&name).to_string_lossy().into_owned(),
            bytes: info.len() as i64,
            files: 1,
            mod_time: mtime,
            reason: "stale transcript".to_string(),
            group,
            meta: BTreeMap::new(),
        });
    }
    Ok(out)
}

#[cfg(test)]
#[path = "cat_transcripts_tests.rs"]
mod cat_transcripts_tests;
