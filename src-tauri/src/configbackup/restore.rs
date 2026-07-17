//! Ports `internal/configbackup/restore.go` (W14) — restore captured backup
//! files back into `root`. Every destination is allowlist-gated AND confined
//! (lexical clean + reject abs / `..`, then confine the NEAREST EXISTING
//! ancestor, so a swapped symlinked ancestor can never redirect a write to a
//! not-yet-existing leaf). settings.json routes through the sanctioned
//! HOME-based `replace_settings_json` (.bak-first, atomic); every other file is
//! temp+rename with a `.bak` inside its confined parent. Never touches
//! projects/, todos/, caches, or `~/.claude.json`. Guards reproduced verbatim
//! (invariant #3). `confine_import_dest` + `write_file_with_bak` are shared with
//! `import.rs`.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};

use crate::configbackup::store::read_manifest;
use crate::configbackup::types::{
    config_backups_dir, match_config_allowlist, validate_backup_id, FileEntry,
    HOOKS_DISABLED_SNAPSHOT_NAME,
};
use crate::files::agents_write::clean;
use crate::files::fsutil::write_file_mode;
use crate::files::pathutil::confine;
use crate::files::settings_write::replace_settings_json;

/// Restores files from backup `id` back into `root`. With an empty `rel_paths`
/// it restores the whole profile (and the hooks-disabled snapshot, if the backup
/// carries one — the one-click undo); otherwise only the named files. Mirrors
/// `RestoreConfig`.
pub fn restore_config(
    root: &Path,
    app_data_dir: &Path,
    id: &str,
    rel_paths: &[String],
) -> Result<(), String> {
    validate_backup_id(id)?;
    let backup_dir = config_backups_dir(app_data_dir).join(id);
    let manifest = read_manifest(&backup_dir)?;

    let canon_root = fs::canonicalize(root)
        .map_err(|e| format!("configbackup: resolve root {}: {e}", root.display()))?;

    let whole_profile = rel_paths.is_empty();
    let selected: Vec<&FileEntry> = if whole_profile {
        manifest.files.iter().collect()
    } else {
        let want: HashSet<String> = rel_paths.iter().map(|r| clean(r)).collect();
        manifest
            .files
            .iter()
            .filter(|e| want.contains(&clean(&e.rel_path)))
            .collect()
    };

    for entry in selected {
        if !match_config_allowlist(&entry.rel_path) {
            return Err(format!(
                "configbackup: refusing to restore non-allowlisted {:?}",
                entry.rel_path
            ));
        }
        let data = fs::read(backup_dir.join(&entry.rel_path))
            .map_err(|e| format!("configbackup: read backup file {:?}: {e}", entry.rel_path))?;
        if clean(&entry.rel_path) == "settings.json" {
            replace_settings_json(&data)
                .map_err(|e| format!("configbackup: restore settings.json: {e}"))?;
            continue;
        }
        let dest = confine_import_dest(&canon_root, &entry.rel_path)?;
        write_file_with_bak(&dest, &data)
            .map_err(|e| format!("configbackup: restore {:?}: {e}", entry.rel_path))?;
    }

    if whole_profile {
        restore_hooks_disabled(app_data_dir, &backup_dir)?;
    }
    Ok(())
}

/// Resolves a root-relative import/restore destination that may not exist yet:
/// lexical clean + reject absolute / any `..` segment, then confine the nearest
/// EXISTING ancestor via `files::confine` (so a swapped symlinked ancestor can't
/// redirect the write). Confining the not-yet-existing leaf would be a no-op, so
/// the ancestor check is load-bearing. Mirrors `confineImportDest`.
pub(super) fn confine_import_dest(canon_root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let cleaned = clean(rel_path);
    if Path::new(&cleaned).is_absolute() {
        return Err(format!("configbackup: dest {:?} must be relative", rel_path));
    }
    for seg in cleaned.split('/') {
        if seg == ".." {
            return Err(format!("configbackup: dest {:?} escapes root", rel_path));
        }
    }

    let dest = canon_root.join(&cleaned);
    let mut ancestor = dest
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| dest.clone());
    loop {
        if fs::symlink_metadata(&ancestor).is_ok() {
            break;
        }
        match ancestor.parent() {
            Some(parent) if parent != ancestor => ancestor = parent.to_path_buf(),
            _ => {
                return Err(format!(
                    "configbackup: no existing ancestor for {:?}",
                    rel_path
                ))
            }
        }
    }
    confine(&ancestor.to_string_lossy(), &canon_root.to_string_lossy())?;
    Ok(dest)
}

/// Writes `data` to `dest` via temp+rename, backing up any existing `dest` to
/// `dest.bak` first. The missing tail below the already-confined ancestor is
/// created 0o700. Mirrors `writeFileWithBak`.
pub(super) fn write_file_with_bak(dest: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)
            .map_err(|e| format!("configbackup: mkdir restore parent: {e}"))?;
    }
    if let Ok(cur) = fs::read(dest) {
        atomic_write(&with_suffix(dest, ".bak"), &cur, 0o644)?;
    }
    atomic_write(dest, data, 0o644)
}

/// Overwrites `<app_data_dir>/hooks-disabled.json` from the backup's snapshot,
/// if present (whole-profile undo). A backup without the snapshot is a no-op.
/// Mirrors `restoreHooksDisabled`.
fn restore_hooks_disabled(app_data_dir: &Path, backup_dir: &Path) -> Result<(), String> {
    let snapshot = backup_dir.join(HOOKS_DISABLED_SNAPSHOT_NAME);
    let data = match fs::read(&snapshot) {
        Ok(d) => d,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("configbackup: read hooks-disabled snapshot: {e}")),
    };
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o755)
        .create(app_data_dir)
        .map_err(|e| format!("configbackup: mkdir app data dir: {e}"))?;
    let dest = app_data_dir.join("hooks-disabled.json");
    if let Ok(cur) = fs::read(&dest) {
        atomic_write(&with_suffix(&dest, ".bak"), &cur, 0o644)?;
    }
    atomic_write(&dest, &data, 0o644)
}

/// Writes `data` to `path` via temp+rename. Mirrors `atomicWrite`.
fn atomic_write(path: &Path, data: &[u8], mode: u32) -> Result<(), String> {
    let tmp = with_suffix(path, ".tmp");
    let base = base_name(&tmp);
    write_file_mode(&tmp, data, mode).map_err(|e| format!("configbackup: write {base}: {e}"))?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("configbackup: rename {base}: {e}"));
    }
    Ok(())
}

/// Byte-appends `suffix` to `path` — mirrors Go's `path + ".bak"` / `+ ".tmp"`.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(suffix);
    PathBuf::from(os)
}

/// Mirrors `filepath.Base(path)` for error messages.
fn base_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "restore_tests.rs"]
mod restore_tests;
