//! Ported from `internal/maintenance/cat_junk.go` (W13). `junk-dsstore`,
//! `junk-tmp`, `junk-emptydirs` + the shared depth-bounded, Lstat-only,
//! app-data-excluded root walk.

use std::collections::BTreeMap;
use std::fs::Metadata;
use std::path::{Path, PathBuf};

use super::category::{
    mtime_utc, older_than, open_dir_no_symlink, read_dir_sorted, same_path, subtree_stats,
};
use super::scan::MAX_SCAN_DEPTH;
use super::types::{Candidate, CategorySpec};

/// Root-level dirs the CLI recreates and expects; the empty-dir matcher never
/// recurses into or offers them, and treats them as real (non-collapsible)
/// content. Mirrors Go `junkProtectedTopLevel`.
fn is_protected_top_level(name: &str) -> bool {
    matches!(name, "projects" | "todos" | "plugins")
}

/// `filepath.Ext` — the suffix from the final `.` (or `""`). Note this differs
/// from `Path::extension`, which returns `None` for a dotfile like `.tmp`.
fn go_ext(name: &str) -> &str {
    match name.rfind('.') {
        Some(i) => &name[i..],
        None => "",
    }
}

fn base_name(path: &Path) -> &str {
    path.file_name().and_then(|n| n.to_str()).unwrap_or("")
}

/// Walks `spec.root` depth-bounded, Lstat-only, skipping the app-data subtree
/// entirely; `visit` runs for every non-root, non-symlink entry (files and
/// dirs). Mirrors Go `walkRootBounded`.
fn walk_root_bounded<F>(spec: &CategorySpec, mut visit: F) -> Result<(), String>
where
    F: FnMut(&Path, &Metadata) -> Result<(), String>,
{
    let root = Path::new(&spec.root);
    walk_bounded_dir(root, root, spec, &mut visit)
}

fn walk_bounded_dir<F>(
    dir: &Path,
    root: &Path,
    spec: &CategorySpec,
    visit: &mut F,
) -> Result<(), String>
where
    F: FnMut(&Path, &Metadata) -> Result<(), String>,
{
    for entry in read_dir_sorted(dir) {
        let path = entry.path();
        if !spec.app_data.is_empty() && same_path(&path, Path::new(&spec.app_data)) {
            continue; // never sweep the app's own data dir (SkipDir)
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue; // never traverse
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            if rel_depth(root, &path) > MAX_SCAN_DEPTH {
                continue; // depth cap (SkipDir)
            }
            visit(&path, &meta)?;
            walk_bounded_dir(&path, root, spec, visit)?;
        } else {
            visit(&path, &meta)?;
        }
    }
    Ok(())
}

/// Separator count of `path` relative to `root` (Go's `strings.Count(rel, sep)`).
fn rel_depth(root: &Path, path: &Path) -> usize {
    match path.strip_prefix(root) {
        Ok(rel) => rel.components().count().saturating_sub(1),
        Err(_) => 0,
    }
}

/// Flags every macOS `.DS_Store` file under the effective root. No age gate.
/// Mirrors Go `scanJunkDSStore`.
pub fn scan_junk_dsstore(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let mut out: Vec<Candidate> = Vec::new();
    walk_root_bounded(spec, |path, meta| {
        if meta.is_dir() || base_name(path) != ".DS_Store" {
            return Ok(());
        }
        out.push(Candidate {
            path: path.to_string_lossy().into_owned(),
            bytes: meta.len() as i64,
            files: 1,
            mod_time: mtime_utc(meta),
            reason: "macOS metadata file".to_string(),
            group: String::new(),
            meta: BTreeMap::new(),
        });
        Ok(())
    })?;
    Ok(out)
}

/// Flags `*.tmp` files older than the cutoff (default 1 day). Mirrors Go
/// `scanJunkTmp`.
pub fn scan_junk_tmp(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let mut out: Vec<Candidate> = Vec::new();
    walk_root_bounded(spec, |path, meta| {
        if meta.is_dir() || go_ext(base_name(path)) != ".tmp" {
            return Ok(());
        }
        let mtime = mtime_utc(meta);
        if !older_than(mtime, spec) {
            return Ok(());
        }
        out.push(Candidate {
            path: path.to_string_lossy().into_owned(),
            bytes: meta.len() as i64,
            files: 1,
            mod_time: mtime,
            reason: "stale temp file".to_string(),
            group: String::new(),
            meta: BTreeMap::new(),
        });
        Ok(())
    })?;
    Ok(out)
}

/// Reports the TOPMOST fully-empty ancestor of every empty subtree as one
/// candidate. Mirrors Go `scanJunkEmptyDirs`.
pub fn scan_junk_empty_dirs(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let mut out: Vec<Candidate> = Vec::new();
    empty_dir_scan(spec, Path::new(&spec.root), 0, &mut out)?;
    Ok(out)
}

/// Bottom-up (post-order) empty-dir collapse. Returns whether `dir` itself is
/// empty; finalizes any empty direct-subdir children when `dir` is the collapse
/// boundary. Mirrors Go `emptyDirScan` (Lstat-only, no symlink traversal,
/// app-data excluded, depth-bounded). "Empty" = nothing, or only `.DS_Store`
/// files and/or recursively-empty subdirs.
fn empty_dir_scan(
    spec: &CategorySpec,
    dir: &Path,
    depth: usize,
    out: &mut Vec<Candidate>,
) -> Result<bool, String> {
    let (entries, ok) = open_dir_no_symlink(dir)?;
    if !ok {
        return Ok(false); // missing/symlink/non-dir — never empty, never a candidate
    }

    let mut empty = true;
    let mut pending_empty: Vec<PathBuf> = Vec::new();
    for e in &entries {
        let child_path = e.path();
        let file_type = match e.file_type() {
            Ok(t) => t,
            Err(_) => {
                empty = false;
                continue;
            }
        };
        if file_type.is_symlink() {
            empty = false; // never traverse/collapse through a symlink
            continue;
        }
        if !file_type.is_dir() {
            if base_name(&child_path) != ".DS_Store" {
                empty = false;
            }
            continue;
        }
        if is_protected_junk_dir(spec, dir, &child_path) || depth >= MAX_SCAN_DEPTH {
            empty = false; // opaque/depth-capped: real, non-collapsible content
            continue;
        }
        if empty_dir_scan(spec, &child_path, depth + 1, out)? {
            pending_empty.push(child_path);
        } else {
            empty = false;
        }
    }

    if empty {
        return Ok(true); // let the parent decide whether to collapse further
    }
    for p in pending_empty {
        let (bytes, files, newest) = subtree_stats(&p);
        out.push(Candidate {
            path: p.to_string_lossy().into_owned(),
            bytes,
            files,
            mod_time: newest,
            reason: "empty directory".to_string(),
            group: String::new(),
            meta: BTreeMap::new(),
        });
    }
    Ok(false)
}

/// Whether `child` must never be recursed into, collapsed, or offered: the app's
/// own data dir, or a root-level dir the CLI recreates. Mirrors Go
/// `isProtectedJunkDir`.
fn is_protected_junk_dir(spec: &CategorySpec, parent: &Path, child: &Path) -> bool {
    if !spec.app_data.is_empty() && same_path(child, Path::new(&spec.app_data)) {
        return true;
    }
    same_path(parent, Path::new(&spec.root)) && is_protected_top_level(base_name(child))
}

#[cfg(test)]
#[path = "cat_junk_tests.rs"]
mod cat_junk_tests;
