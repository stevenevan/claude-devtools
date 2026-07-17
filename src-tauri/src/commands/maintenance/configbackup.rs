//! Tauri command wrappers for the config backup / export / import surface of
//! `MaintenanceService` (Go `internal/maintenanceservice/configbackup.go`, W14).
//! Delegates to the ported pure `crate::configbackup::*` over
//! `root = effective claude root`, `app_data_dir = config::root::app_data_dir()`.
//!
//! Concurrency reproduces Go: the mutating ops (capture/restore/delete/export/
//! apply) serialize under `op` + are SSH-gated; `restore_config`/`apply_import`
//! mute the watcher (`MuteGuard`). `list`/`validate` are read-only (no gate).
//! `export_backup` uses the native SaveFile dialog and `validate_import_dialog`
//! the native OpenFile dialog — a cancelled dialog is a no-op / empty preview,
//! NOT an error. Both are `async` so the blocking dialog runs off the main
//! thread (a sync command would deadlock the event loop).

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::service::Maint;
use super::state::MuteGuard;
use crate::configbackup::capture::capture_config as capture_config_fn;
use crate::configbackup::export::export_backup as export_backup_fn;
use crate::configbackup::import::{apply_import as apply_import_fn, validate_import as validate_import_fn};
use crate::configbackup::restore::restore_config as restore_config_fn;
use crate::configbackup::store::{
    delete_config_backup as delete_config_backup_fn, list_config_backups as list_config_backups_fn,
};
use crate::configbackup::types::{ImportPreview, Manifest};

/// Snapshots the current config into the app-owned store. SSH-gated under `op`.
/// Mirrors `CaptureConfig`.
#[tauri::command(rename_all = "camelCase")]
pub fn capture_config(label: String, state: Maint) -> Result<Manifest, String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let app_data = state.app_data()?;
    let root = state.effective_root();
    capture_config_fn(Path::new(&root), Path::new(&app_data), &label, false)
}

/// Lists every stored config backup. Read-only: no SSH gate, no mutex. Mirrors
/// `ListConfigBackups`.
#[tauri::command(rename_all = "camelCase")]
pub fn list_config_backups(state: Maint) -> Result<Vec<Manifest>, String> {
    let app_data = state.app_data()?;
    list_config_backups_fn(Path::new(&app_data))
}

/// Restores a backup (whole profile when `rel_paths` empty, else the named
/// files). SSH-gated under `op`; mutes the watcher for the batch. Mirrors
/// `RestoreConfig`.
#[tauri::command(rename_all = "camelCase")]
pub fn restore_config(
    id: String,
    rel_paths: Vec<String>,
    app: AppHandle,
    state: Maint,
) -> Result<(), String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let app_data = state.app_data()?;
    let root = state.effective_root();
    let _mute = MuteGuard::new(&app);
    restore_config_fn(Path::new(&root), Path::new(&app_data), &id, &rel_paths)
}

/// Removes one stored backup's dir tree. SSH-gated under `op`. Mirrors
/// `DeleteConfigBackup`.
#[tauri::command(rename_all = "camelCase")]
pub fn delete_config_backup(id: String, state: Maint) -> Result<(), String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let app_data = state.app_data()?;
    delete_config_backup_fn(Path::new(&app_data), &id)
}

/// Packs a backup into a zip the user picks via the native SaveFile dialog
/// (secrets stripped unless `include_secrets`). A cancelled dialog is a no-op,
/// NOT an error. SSH-gated under `op`. Mirrors `ExportBackup`.
#[tauri::command(rename_all = "camelCase")]
pub async fn export_backup(
    id: String,
    include_secrets: bool,
    app: AppHandle,
    state: Maint<'_>,
) -> Result<(), String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let app_data = state.app_data()?;

    let suggested = export_filename(&app_data, &id);
    let Some(file_path) = app
        .dialog()
        .file()
        .set_file_name(&suggested)
        .add_filter("Config archive", &["zip"])
        .blocking_save_file()
    else {
        return Ok(()); // user cancel — no-op
    };
    let dest = file_path.into_path().map_err(|e| e.to_string())?;
    export_backup_fn(Path::new(&app_data), &id, &dest, include_secrets)
}

/// Opens a native OpenFile dialog, then fail-closed validates the chosen archive
/// and returns the review preview. A cancelled dialog returns an empty preview
/// (no error). Read-only (no disk writes); no SSH gate. Mirrors
/// `ValidateImportDialog`.
#[tauri::command(rename_all = "camelCase")]
pub async fn validate_import_dialog(app: AppHandle) -> Result<ImportPreview, String> {
    let Some(file_path) = app
        .dialog()
        .file()
        .add_filter("Config archive", &["zip"])
        .blocking_pick_file()
    else {
        return Ok(empty_preview()); // user cancel — empty preview
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    validate_import_fn(&path)
}

/// Applies the confirmed categories of a validated archive (a pre-import
/// auto-snapshot is taken first; imported hooks land disabled). SSH-gated under
/// `op`; mutes the watcher for the batch. Mirrors `ApplyImport`.
#[tauri::command(rename_all = "camelCase")]
pub fn apply_import(
    archive_path: String,
    confirmed_categories: Vec<String>,
    app: AppHandle,
    state: Maint,
) -> Result<(), String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let app_data = state.app_data()?;
    let root = state.effective_root();
    let _mute = MuteGuard::new(&app);
    apply_import_fn(
        Path::new(&root),
        Path::new(&app_data),
        Path::new(&archive_path),
        &confirmed_categories,
    )
}

/// The zero-value preview a cancelled OpenFile dialog returns (`ImportPreview{}`).
fn empty_preview() -> ImportPreview {
    ImportPreview {
        hook_commands: Vec::new(),
        permission_rules: Vec::new(),
        categories: Vec::new(),
        secrets_included: false,
        archive_path: String::new(),
    }
}

/// Derives a filename-safe suggested archive name from the backup's label,
/// falling back to a generic name. Mirrors `exportFilename`.
fn export_filename(app_data: &str, id: &str) -> String {
    let mut name = "config-backup".to_string();
    if let Ok(backups) = list_config_backups_fn(Path::new(app_data)) {
        for b in &backups {
            if b.id == id && !b.label.is_empty() {
                name = b.label.clone();
                break;
            }
        }
    }
    let name: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' => '-',
            other => other,
        })
        .collect();
    format!("{name}.zip")
}
