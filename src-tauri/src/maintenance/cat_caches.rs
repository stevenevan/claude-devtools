//! Ported from `internal/maintenance/cat_caches.go` (W13). Surfaces the small
//! regenerable caches (plain-delete) via a KNOWN-SURFACE ALLOWLIST, plus
//! paste-cache blobs (flagged sensitive — may hold pasted secrets).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use super::category::{mtime_utc, open_dir_no_symlink};
use super::types::{Candidate, CategorySpec};

/// The KNOWN-SURFACE ALLOWLIST — never a `*cache*` glob. `(rel, regenerated_by)`.
/// Mirrors Go `cacheSurfaces`.
const CACHE_SURFACES: &[(&str, &str)] = &[
    ("cache/changelog.md", "CLI update check"),
    ("stats-cache.json", "usage tracking"),
    ("mcp-needs-auth-cache.json", "next MCP probe"),
];

pub fn scan_caches(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let root = Path::new(&spec.root);
    let mut out: Vec<Candidate> = Vec::new();

    for (rel, regenerated_by) in CACHE_SURFACES {
        let p = root.join(rel);
        let info = match fs::symlink_metadata(&p) {
            Ok(i) => i,
            Err(_) => continue,
        };
        if info.is_dir() || info.file_type().is_symlink() {
            continue;
        }
        let mut meta = BTreeMap::new();
        meta.insert("regeneratedBy".to_string(), (*regenerated_by).to_string());
        out.push(Candidate {
            path: p.to_string_lossy().into_owned(),
            bytes: info.len() as i64,
            files: 1,
            mod_time: mtime_utc(&info),
            reason: "cache — rebuilt on demand".to_string(),
            group: String::new(),
            meta,
        });
    }

    let paste_dir = root.join("paste-cache");
    let (entries, ok) = open_dir_no_symlink(&paste_dir)?;
    if ok {
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
            meta.insert("regeneratedBy".to_string(), "next paste".to_string());
            meta.insert("sensitive".to_string(), "true".to_string());
            out.push(Candidate {
                path: paste_dir.join(&name).to_string_lossy().into_owned(),
                bytes: info.len() as i64,
                files: 1,
                mod_time: mtime_utc(&info),
                reason: "pasted content — may contain sensitive text".to_string(),
                group: "paste-cache".to_string(),
                meta,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
#[path = "cat_logs_caches_tests.rs"]
mod cat_logs_caches_tests;
