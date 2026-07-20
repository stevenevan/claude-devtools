//! Ports `internal/configbackup/store.go` — manifest read/write (atomic
//! temp+rename, mode 0o600) and the backup store enumeration / deletion under
//! `<app_data_dir>/config-backups/`. Also hosts the unix mode primitives capture
//! reuses (`write_file_mode`, `mkdir_all_mode`, `set_mode`).

use std::fs;
use std::path::{Path, PathBuf};

use super::types::{config_backups_dir, validate_backup_id, Manifest};
use crate::files::json_util::to_go_json_pretty;

/// backup_dir/manifest.json
fn manifest_path(backup_dir: &Path) -> PathBuf {
    backup_dir.join("manifest.json")
}

/// Writes manifest.json atomically (temp+rename), mode 0o600 (it lists user
/// config paths). Mirrors `writeManifest`.
pub(crate) fn write_manifest(backup_dir: &Path, m: &Manifest) -> Result<(), String> {
    let data = to_go_json_pretty(m).map_err(|e| format!("configbackup: marshal manifest: {e}"))?;
    let path = manifest_path(backup_dir);
    let mut tmp_os = path.clone().into_os_string();
    tmp_os.push(".tmp");
    let tmp = PathBuf::from(tmp_os);

    write_file_mode(&tmp, &data, 0o600).map_err(|e| format!("configbackup: write manifest: {e}"))?;
    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("configbackup: rename manifest: {e}"));
    }
    Ok(())
}

/// Reads and parses backup_dir/manifest.json. Mirrors `readManifest`.
pub(crate) fn read_manifest(backup_dir: &Path) -> Result<Manifest, String> {
    let data =
        fs::read(manifest_path(backup_dir)).map_err(|e| format!("configbackup: read manifest: {e}"))?;
    serde_json::from_slice(&data).map_err(|e| format!("configbackup: parse manifest: {e}"))
}

/// Enumerates every backup's manifest under `<app_data_dir>/config-backups`,
/// newest first. A missing store is not an error. Mirrors `ListConfigBackups`.
pub fn list_config_backups(app_data_dir: &Path) -> Result<Vec<Manifest>, String> {
    let base = config_backups_dir(app_data_dir);
    let read_dir = match fs::read_dir(&base) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("configbackup: read backup store: {e}")),
    };

    // Mirror Go's os.ReadDir (filename-sorted) so the stable createdMs sort has a
    // deterministic tie-break order.
    let mut entries: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    let mut out: Vec<Manifest> = Vec::new();
    for entry in entries {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        if let Ok(m) = read_manifest(&entry.path()) {
            out.push(m); // no/corrupt manifest — skip, not fatal
        }
    }
    // newest first, STABLE (mirror sort.SliceStable on CreatedMs descending).
    out.sort_by(|a, b| {
        b.created_ms
            .partial_cmp(&a.created_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

/// Removes one backup's whole dir tree. The store is app-owned (never user
/// data). A missing dir is a no-op (mirrors Go's `os.RemoveAll`).
pub fn delete_config_backup(app_data_dir: &Path, id: &str) -> Result<(), String> {
    validate_backup_id(id)?;
    let target = config_backups_dir(app_data_dir).join(id);
    match fs::remove_dir_all(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("configbackup: remove backup {id:?}: {e}")),
    }
}

// ── unix mode primitives (shared with capture) ──────────────────────────────

/// `os.WriteFile(path, data, mode)`: create/truncate with `mode` (umask-masked
/// on creation, like Go).
pub(super) fn write_file_mode(path: &Path, data: &[u8], mode: u32) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(mode);
    }
    #[cfg(not(unix))]
    {
        let _ = mode;
    }
    let mut f = opts.open(path)?;
    f.write_all(data)
}

/// `os.MkdirAll(path, mode)`: recursive create, applying `mode` to every new
/// component (umask-masked), exactly like Go's MkdirAll.
pub(super) fn mkdir_all_mode(path: &Path, mode: u32) -> std::io::Result<()> {
    let mut b = fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(mode);
    }
    #[cfg(not(unix))]
    {
        let _ = mode;
    }
    b.create(path)
}

/// `os.Chmod(path, mode)`: force exact permission bits (bypasses umask).
#[cfg(unix)]
pub(super) fn set_mode(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
pub(super) fn set_mode(_path: &Path, _mode: u32) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod store_tests;
