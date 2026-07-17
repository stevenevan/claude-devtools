//! Ported from `internal/maintenance/cat_filehistory.go` (W13). Surfaces
//! reclaimable storage under `<root>/file-history` (per-UUID edit-undo snapshot
//! dirs, no built-in retention). Split into `empty` (zero snapshot files) and
//! `stale` (newest snapshot aged past the cutoff, default 30d). Age comes from
//! the newest descendant mtime, not the dir's own.

use std::collections::BTreeMap;
use std::path::Path;

use super::category::{older_than, open_dir_no_symlink, subtree_stats};
use super::types::{Candidate, CategorySpec};

pub fn scan_file_history(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let dir = Path::new(&spec.root).join("file-history");
    let (entries, ok) = open_dir_no_symlink(&dir)?;
    if !ok {
        return Ok(Vec::new());
    }

    let mut out: Vec<Candidate> = Vec::new();
    for e in &entries {
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue; // per-UUID dirs; stray files are not ours to judge
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let uuid_dir = dir.join(&name);
        let (bytes, files, newest) = subtree_stats(&uuid_dir);

        let mut meta = BTreeMap::new();
        meta.insert("uuid".to_string(), name.clone());

        if files == 0 {
            out.push(Candidate {
                path: uuid_dir.to_string_lossy().into_owned(),
                bytes,
                files,
                mod_time: newest,
                reason: "empty history dir".to_string(),
                group: "empty".to_string(),
                meta,
            });
            continue;
        }
        if !older_than(newest, spec) {
            continue;
        }
        out.push(Candidate {
            path: uuid_dir.to_string_lossy().into_owned(),
            bytes,
            files,
            mod_time: newest,
            reason: "no edits in 30+ days".to_string(),
            group: "stale".to_string(),
            meta,
        });
    }
    Ok(out)
}

#[cfg(test)]
#[path = "cat_filehistory_tests.rs"]
mod cat_filehistory_tests;
