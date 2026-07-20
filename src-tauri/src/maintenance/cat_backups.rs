//! Ported from `internal/maintenance/cat_backups.go` (W13). Flags `*.bak` backup
//! siblings of the status-line / hook binaries in `<root>` and `<root>/hooks`.
//! Each carries a sha256 and, when an active sibling exists, an `identical` flag
//! (pure duplicate vs distinct rollback point). A file in `spec.active` (the
//! binaries live settings.json references) is NEVER a candidate. No age gate.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::category::{bool_str, mtime_utc, open_dir_no_symlink};
use super::types::{Candidate, CategorySpec};

pub fn scan_backup_binaries(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let mut active: HashSet<PathBuf> = HashSet::new();
    let mut active_sum: HashMap<String, String> = HashMap::new(); // (dir\0base) → checksum
    for p in &spec.active {
        let p_path = Path::new(p);
        active.insert(lexical_clean(p_path));
        if let Ok(sum) = file_sha256(p_path) {
            let dir = p_path.parent().unwrap_or_else(|| Path::new(""));
            let base = backup_base_name(file_name(p_path));
            active_sum.insert(dir_base_key(dir, base), sum);
        }
    }

    let root = Path::new(&spec.root);
    let dirs = [root.to_path_buf(), root.join("hooks")];

    let mut out: Vec<Candidate> = Vec::new();
    for dir in &dirs {
        let (entries, ok) = open_dir_no_symlink(dir)?;
        if !ok {
            continue;
        }
        for e in &entries {
            let name = e.file_name().to_string_lossy().into_owned();
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir || !name.ends_with(".bak") {
                continue;
            }
            let path = dir.join(&name);
            if active.contains(&lexical_clean(&path)) {
                continue; // active binaries are never candidates
            }
            let Ok(info) = e.metadata() else {
                continue;
            };
            if info.file_type().is_symlink() {
                continue;
            }
            let Ok(sum) = file_sha256(&path) else {
                continue;
            };
            let base = backup_base_name(&name).to_string();
            let mut meta = BTreeMap::new();
            meta.insert("base".to_string(), base.clone());
            meta.insert("checksum".to_string(), sum.clone());
            let mut reason = "backup binary".to_string();
            if let Some(a_sum) = active_sum.get(&dir_base_key(dir, &base)) {
                let identical = *a_sum == sum;
                meta.insert("identical".to_string(), bool_str(identical).to_string());
                reason = if identical {
                    "duplicate of the active binary".to_string()
                } else {
                    "distinct backup (rollback point)".to_string()
                };
            }
            out.push(Candidate {
                path: path.to_string_lossy().into_owned(),
                bytes: info.len() as i64,
                files: 1,
                mod_time: mtime_utc(&info),
                reason,
                group: base,
                meta,
            });
        }
    }
    Ok(out)
}

/// The binary family key: the file name up to its first dot (index > 0).
/// Mirrors Go `backupBaseName`.
fn backup_base_name(name: &str) -> &str {
    match name.find('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    }
}

fn dir_base_key(dir: &Path, base: &str) -> String {
    format!("{}\u{0}{base}", lexical_clean(dir).to_string_lossy())
}

fn file_name(p: &Path) -> &str {
    p.file_name().and_then(|n| n.to_str()).unwrap_or("")
}

/// Lexical path normalization (component-wise) matching `filepath.Clean` for the
/// `..`-free absolute paths handled here.
fn lexical_clean(p: &Path) -> PathBuf {
    p.components().collect()
}

fn file_sha256(path: &Path) -> Result<String, ()> {
    let data = fs::read(path).map_err(|_| ())?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
#[path = "cat_backups_tests.rs"]
mod cat_backups_tests;
