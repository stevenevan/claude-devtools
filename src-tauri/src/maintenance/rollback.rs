//! Ports `internal/maintenance/rollback.go` — the atomic status-line/hook binary
//! replace. `rollback_binary` replaces the active binary with a backup's
//! CONTENTS, after first TRASHING a copy of the current active (via an INJECTED
//! trash closure) so the rollback is itself reversible. The live active is never
//! moved before the atomic rename. Guards reproduced verbatim (invariant #3):
//! active + backup are parent-confined to a root, a symlinked/missing leaf is
//! refused, the restored file keeps the active's mode with owner-exec forced, and
//! the write is temp+fsync+rename.
//!
//! The confinement + copy helpers are reproduced locally rather than imported
//! from `trash.rs` (the injected-closure design keeps this module off the trash
//! engine); they mirror `canonicalizeRoots` / `resolveAppDataDir` /
//! `confineParentToRoot` / `copyFile` / `copyFileFsync` and reuse
//! `crate::files::pathutil::confine` as the per-root primitive.

use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};

use uuid::Uuid;

use crate::files::pathutil::{confine, ERR_ESCAPES_ROOT};

/// Replaces the active binary at `active_path` with `backup_path`'s contents,
/// atomically, after trashing a copy of the current active via `trash`. `R` is
/// the trash closure's receipt type — rollback.rs never names the trash engine's
/// `TrashReceipt`. Mirrors `RollbackBinary`.
pub fn rollback_binary<F, R>(
    roots: &[String],
    app_data_dir: &str,
    active_path: &str,
    backup_path: &str,
    trash: F,
) -> Result<R, String>
where
    F: Fn(&[String]) -> Result<R, String>,
{
    // Resolve appData first (creating it) so a roots entry pointing at a
    // not-yet-existing appData dir still canonicalizes.
    let canon_app_data = resolve_app_data_dir(app_data_dir, true)?;
    let canon_roots = canonicalize_roots(roots)?;

    let (active_parent, active_base) = confine_leaf_for_replace(active_path, &canon_roots)
        .map_err(|e| format!("maintenance: active {active_path:?}: {e}"))?;
    let (backup_parent, backup_base) = confine_leaf_for_replace(backup_path, &canon_roots)
        .map_err(|e| format!("maintenance: backup {backup_path:?}: {e}"))?;
    let active_full = Path::new(&active_parent).join(&active_base);
    let backup_full = Path::new(&backup_parent).join(&backup_base);

    let active_info = fs::symlink_metadata(&active_full)
        .map_err(|e| format!("maintenance: active {active_path:?}: {e}"))?;
    // Force owner-exec (a .bak may have lost +x).
    let mode = (active_info.permissions().mode() & 0o777) | 0o100;

    // 1) Preserve the current active: copy its bytes to a throwaway under
    //    appData and trash THAT (never move the live binary).
    let tmp_dir = Path::new(&canon_app_data).join("rollback-tmp");
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&tmp_dir)
        .map_err(|e| e.to_string())?;
    let tmp_copy = tmp_dir.join(format!("active-{}", Uuid::new_v4()));
    copy_file(&active_full, &tmp_copy, mode)
        .map_err(|e| format!("maintenance: preserve active: {e}"))?;

    let tmp_copy_str = tmp_copy.to_string_lossy().into_owned();
    let receipt = match trash(std::slice::from_ref(&tmp_copy_str)) {
        Ok(r) => r,
        Err(e) => {
            let _ = fs::remove_file(&tmp_copy);
            return Err(format!("maintenance: preserve active: {e}"));
        }
    };

    // 2) Atomically replace the active binary with the backup's contents.
    let tmp_new = PathBuf::from(format!("{}.rollback.tmp", active_full.to_string_lossy()));
    if let Err(e) = copy_file_fsync(&backup_full, &tmp_new, mode) {
        let _ = fs::remove_file(&tmp_new);
        // Go returns (receipt, err); a Rust `Result` can't carry both — the prior
        // active is already trashed, so surface the error.
        return Err(format!("maintenance: write new active: {e}"));
    }
    if fs::symlink_metadata(&active_full).is_err() {
        // re-check immediately before rename
        let _ = fs::remove_file(&tmp_new);
        return Err("maintenance: active vanished before rollback".to_string());
    }
    if let Err(e) = fs::rename(&tmp_new, &active_full) {
        let _ = fs::remove_file(&tmp_new);
        return Err(format!("maintenance: rename new active: {e}"));
    }
    sync_dir(&active_parent);
    Ok(receipt)
}

/// Parent-confines path (canonicalize the parent, confine it, Lstat the leaf) and
/// refuses a symlinked or missing leaf — never canonicalizes the leaf itself.
/// Returns the canonical parent + base. Mirrors `confineLeafForReplace`.
fn confine_leaf_for_replace(
    path: &str,
    canon_roots: &[String],
) -> Result<(String, String), String> {
    let cleaned = lexical_clean(path);
    if !Path::new(&cleaned).is_absolute() {
        return Err("path must be absolute".to_string());
    }
    let parent = Path::new(&cleaned)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let parent_canon = confine_parent_to_root(&parent, canon_roots)?;
    let base = Path::new(&cleaned)
        .file_name()
        .map(|b| b.to_string_lossy().into_owned())
        .unwrap_or_default();
    let leaf = Path::new(&parent_canon).join(&base);
    let lst = fs::symlink_metadata(&leaf).map_err(|e| e.to_string())?;
    if lst.file_type().is_symlink() {
        return Err("refusing to operate on a symlink".to_string());
    }
    Ok((parent_canon, base))
}

/// Resolves parent (which must exist) and confirms it falls within one of
/// canon_roots, reusing `pathutil::confine` per-root. Mirrors
/// `confineParentToRoot`.
fn confine_parent_to_root(parent: &str, canon_roots: &[String]) -> Result<String, String> {
    let canon = fs::canonicalize(parent)
        .map_err(|e| format!("parent {parent:?} does not resolve: {e}"))?;
    let canon_str = canon.to_string_lossy().into_owned();
    for root in canon_roots {
        if confine(&canon_str, root).is_ok() {
            return Ok(canon_str);
        }
    }
    Err(ERR_ESCAPES_ROOT.to_string())
}

/// Canonicalizes every root once (fail-closed). Mirrors `canonicalizeRoots`.
fn canonicalize_roots(roots: &[String]) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(roots.len());
    for r in roots {
        let c = fs::canonicalize(r)
            .map_err(|e| format!("maintenance: root {r:?} does not resolve: {e}"))?;
        out.push(c.to_string_lossy().into_owned());
    }
    Ok(out)
}

/// Optionally creates app_data_dir (0755) then canonicalizes it. Mirrors
/// `resolveAppDataDir`.
fn resolve_app_data_dir(app_data_dir: &str, create: bool) -> Result<String, String> {
    if create {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o755)
            .create(app_data_dir)
            .map_err(|e| format!("maintenance: create app-data dir: {e}"))?;
    }
    let canon = fs::canonicalize(app_data_dir)
        .map_err(|e| format!("maintenance: app-data dir {app_data_dir:?} does not resolve: {e}"))?;
    Ok(canon.to_string_lossy().into_owned())
}

/// Copies src→dst preserving mode (no fsync), force-chmod after (OpenFile's mode
/// is subject to umask). Mirrors `copyFile`.
fn copy_file(src: &Path, dst: &Path, mode: u32) -> Result<(), String> {
    let mut input = File::open(src).map_err(|e| e.to_string())?;
    let mut out = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(mode)
        .open(dst)
        .map_err(|e| e.to_string())?;
    io::copy(&mut input, &mut out).map_err(|e| e.to_string())?;
    drop(out); // close (no fsync — that's copy_file_fsync)
    fs::set_permissions(dst, fs::Permissions::from_mode(mode)).map_err(|e| e.to_string())
}

/// Copies src→dst preserving mode, fsyncing the file before close so a crash
/// can't leave a partial/zero-length executable. Mirrors `copyFileFsync`.
fn copy_file_fsync(src: &Path, dst: &Path, mode: u32) -> Result<(), String> {
    let mut input = File::open(src).map_err(|e| e.to_string())?;
    let mut out = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(mode)
        .open(dst)
        .map_err(|e| e.to_string())?;
    io::copy(&mut input, &mut out).map_err(|e| e.to_string())?;
    out.sync_all().map_err(|e| e.to_string())?;
    drop(out);
    fs::set_permissions(dst, fs::Permissions::from_mode(mode)).map_err(|e| e.to_string())
}

/// Fsyncs a directory so a rename is durable (best-effort). Mirrors `syncDir`.
fn sync_dir(dir: &str) {
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
}

/// Lexical path clean mirroring `filepath.Clean` for absolute unix paths
/// (collapse `.`/`//`, resolve `..` against non-`..` predecessors).
fn lexical_clean(p: &str) -> String {
    let path = Path::new(p);
    let mut is_abs = false;
    let mut stack: Vec<String> = Vec::new();
    for comp in path.components() {
        match comp {
            Component::RootDir => is_abs = true,
            Component::CurDir => {}
            Component::ParentDir => match stack.last() {
                Some(last) if last != ".." => {
                    stack.pop();
                }
                Some(_) => stack.push("..".to_string()),
                None => {
                    if !is_abs {
                        stack.push("..".to_string());
                    }
                }
            },
            Component::Normal(s) => stack.push(s.to_string_lossy().into_owned()),
            Component::Prefix(_) => {}
        }
    }
    let mut result = String::new();
    if is_abs {
        result.push('/');
    }
    result.push_str(&stack.join("/"));
    if result.is_empty() {
        ".".to_string()
    } else {
        result
    }
}

#[cfg(test)]
#[path = "rollback_tests.rs"]
mod rollback_tests;
