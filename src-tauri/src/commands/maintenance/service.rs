//! Tauri command wrappers for the `service.go` surface of `MaintenanceService`
//! (scan / cutoff / plan / rollback / history / clear / health / settings
//! generations / cancel / trash). Each mirrors a Go method 1:1; destructive ones
//! reproduce the ssh-gate (`op` mutex + `ssh_gate`) and, where Go mutes,
//! `MuteGuard`. Read-only ones take no gate and no mutex.

use std::cell::Cell;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use chrono::{Duration, Utc};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use super::state::{
    is_active_binary, refuse_system_root, MaintenanceState, MuteGuard, PROGRESS_THROTTLE,
};
use crate::files::pathutil::confine;
use crate::files::settings_generations::{
    list_settings_generations as list_gens, read_settings_generation as read_gen,
    restore_settings_generation as restore_gen,
};
use crate::maintenance::category::{cutoff_default, scan_category as scan_category_matcher};
use crate::maintenance::health::{maintenance_health, HealthStatus};
use crate::maintenance::history::{analyze_history as analyze_history_fn, prune_history as prune_history_fn, HistoryStats};
use crate::maintenance::plaindelete::clear_files as clear_files_fn;
use crate::maintenance::rollback::rollback_binary as rollback_binary_fn;
use crate::maintenance::scan::scan_claude_dir as scan_claude_dir_fn;
use crate::maintenance::simple_cleanup as simple;
use crate::maintenance::simple_cleanup::{SimpleCleanupPreview, SimpleCleanupReport};
use crate::maintenance::trash::{
    self, empty_trash as empty_trash_fn, list_trash as list_trash_fn, restore_trash as restore_trash_fn,
    TrashReceipt,
};
use crate::maintenance::types::{Candidate, CategorySpec, DirUsage};

pub(crate) type Maint<'a> = State<'a, Arc<MaintenanceState>>;

/// Scans the claude root + app-data tree, rejecting if a scan/policy is already
/// in progress. Throttles `maintenance:scan-progress` to one emit / 150ms.
#[tauri::command(rename_all = "camelCase")]
pub fn scan_claude_dir(app: AppHandle, state: Maint) -> Result<Vec<DirUsage>, String> {
    let _run = state.claim_run("maintenance: a scan is already in progress")?;
    let roots = state.resolve_roots()?;

    let last: Cell<Option<Instant>> = Cell::new(None);
    let cb = |dirs: usize, bytes: i64| {
        let now = Instant::now();
        let due = last
            .get()
            .is_none_or(|t| now.duration_since(t) >= PROGRESS_THROTTLE);
        if !due {
            return;
        }
        last.set(Some(now));
        let _ = app.emit(
            "maintenance:scan-progress",
            json!({ "dirsVisited": dirs, "bytes": bytes }),
        );
    };
    scan_claude_dir_fn(&roots, Some(&cb))
}

/// Runs one leaf-category matcher. Read-only: no gate, no mutex. Mirrors
/// `ScanCategory`.
#[tauri::command(rename_all = "camelCase")]
pub fn scan_category(id: String, state: Maint) -> Result<Vec<Candidate>, String> {
    let effective = state.effective_root();
    refuse_system_root(&effective)?;
    let app_data = state.app_data()?;

    let mut days = cutoff_default(&id);
    if let Some(override_days) = state.config.get_maintenance_cutoff(&id) {
        days = override_days;
    }
    let now = Utc::now();
    let cutoff = (days > 0).then(|| now - Duration::days(days));

    let mut spec = CategorySpec {
        id: id.clone(),
        root: effective.clone(),
        app_data,
        cutoff,
        now,
        enabled: Vec::new(),
        pinned: Vec::new(),
        active: Vec::new(),
    };
    enrich_spec(state.inner(), &id, &effective, &mut spec);
    scan_category_matcher(&spec)
}

/// Builds every Simple cleanup spec from the backend-owned allowlist. The
/// renderer cannot choose these ids or alter their cutoffs.
fn simple_cleanup_specs(
    state: &MaintenanceState,
    effective: &str,
    app_data: &str,
) -> Vec<CategorySpec> {
    let now = Utc::now();
    simple::SIMPLE_CATEGORIES
        .iter()
        .map(|category| {
            let days = state
                .config
                .get_maintenance_cutoff(category.id)
                .unwrap_or_else(|| cutoff_default(category.id));
            CategorySpec {
                id: category.id.to_string(),
                root: effective.to_string(),
                app_data: app_data.to_string(),
                cutoff: (days > 0).then(|| now - Duration::days(days)),
                now,
                enabled: Vec::new(),
                pinned: Vec::new(),
                active: Vec::new(),
            }
        })
        .collect()
}

/// Returns aggregate-only cleanup candidates and a short-lived opaque token.
/// The candidate paths remain in managed backend state for revalidation.
#[tauri::command(rename_all = "camelCase")]
pub fn preview_simple_cleanup(state: Maint) -> Result<SimpleCleanupPreview, String> {
    let _run = state.claim_run("maintenance: a scan is already in progress")?;
    let _op = state.lock_op();
    let effective = state.effective_root();
    refuse_system_root(&effective)?;
    let app_data = state.app_data()?;
    let specs = simple_cleanup_specs(state.inner(), &effective, &app_data);
    let candidates = simple::scan_allowlist(&specs)?;
    let total_candidates = candidates.len();
    let total_bytes = simple::total_bytes(&candidates);
    let categories = simple::summarize(&candidates);
    let token = state.store_simple_cleanup_preview(candidates);
    Ok(SimpleCleanupPreview {
        token,
        total_candidates,
        total_bytes,
        categories,
    })
}

/// Revalidates and moves the previously previewed allowlist candidates through
/// the existing trash engine. No renderer-supplied path is accepted here.
#[tauri::command(rename_all = "camelCase")]
pub fn run_simple_cleanup(
    token: String,
    app: AppHandle,
    state: Maint,
) -> Result<SimpleCleanupReport, String> {
    let _run = state.claim_run("maintenance: a scan or cleanup is already in progress")?;
    let _op = state.lock_op();
    state.ssh_gate()?;

    let expected = state.simple_cleanup_snapshot(&token)?;
    let effective = state.effective_root();
    refuse_system_root(&effective)?;
    let app_data = state.app_data()?;
    let specs = simple_cleanup_specs(state.inner(), &effective, &app_data);
    let actual = simple::scan_allowlist(&specs)?;
    if !simple::same_snapshot(&expected, &actual) {
        state.clear_simple_cleanup_preview();
        return Err("maintenance: preview changed; refresh".to_string());
    }

    let roots = state.resolve_roots()?;
    let _mute = MuteGuard::new(&app);
    let mut moved_candidates = 0usize;
    let mut moved_bytes = 0i64;
    for (batch_index, batch) in expected.chunks(simple::TRASH_BATCH_SIZE).enumerate() {
        let paths: Vec<String> = batch
            .iter()
            .map(|candidate| candidate.candidate.path.clone())
            .collect();
        let receipt = match trash::trash_items(&roots, &app_data, &paths) {
            Ok(receipt) => receipt,
            Err(error) => {
                state.clear_simple_cleanup_preview();
                return Err(format!(
                    "maintenance: simple cleanup moved {moved_candidates} of {} candidates before batch {} failed: {error}",
                    expected.len(),
                    batch_index + 1
                ));
            }
        };
        moved_candidates += receipt.items.len();
        moved_bytes += receipt.items.iter().map(|item| item.bytes).sum::<i64>();
        state.evict_trashed_projects(&app, &receipt);
    }

    state.clear_simple_cleanup_preview();
    let storage_dirs = scan_claude_dir_fn(&roots, None)
        .map_err(|error| format!("maintenance: simple cleanup storage rescan failed: {error}"))?;
    Ok(SimpleCleanupReport {
        moved_candidates,
        moved_bytes,
        storage: simple::summarize_storage(&storage_dirs),
    })
}

/// Populates the id-specific spec fields (plugins→enabled, projects→pinned,
/// backup-binaries→active). Shared by `scan_category` and the policy enrich.
pub(crate) fn enrich_spec(
    state: &MaintenanceState,
    id: &str,
    effective: &str,
    spec: &mut CategorySpec,
) {
    match id {
        "plugins" => spec.enabled = super::state::read_enabled_plugins(effective),
        "projects" => spec.pinned = state.pinned_session_ids(),
        "backup-binaries" => spec.active = super::state::read_active_binaries(effective),
        _ => {}
    }
}

/// Persisted cutoff (days) for a category, or the matcher default when unset.
#[tauri::command(rename_all = "camelCase")]
pub fn get_maintenance_cutoff(id: String, state: Maint) -> Result<i64, String> {
    Ok(state
        .config
        .get_maintenance_cutoff(&id)
        .unwrap_or_else(|| cutoff_default(&id)))
}

/// Persists a clamped per-category cutoff. NOT ssh-gated (Go quirk — kept).
#[tauri::command(rename_all = "camelCase")]
pub fn set_maintenance_cutoff(id: String, days: i64, state: Maint) -> Result<(), String> {
    state.config.set_maintenance_cutoff(&id, days)
}

/// Returns a plan file's raw contents, Confine-checked to `<root>/plans` — never
/// an arbitrary-read primitive. Mirrors `ReadPlanFile`.
#[tauri::command(rename_all = "camelCase")]
pub fn read_plan_file(name: String, state: Maint) -> Result<String, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains(std::path::MAIN_SEPARATOR)
        || name == "."
        || name == ".."
    {
        return Err("maintenance: invalid plan file name".to_string());
    }
    let root = state.effective_root();
    let plans_dir = std::fs::canonicalize(Path::new(&root).join("plans"))
        .map_err(|e| format!("maintenance: plans dir: {e}"))?;
    let plans_dir_s = plans_dir.to_string_lossy().into_owned();
    let candidate = plans_dir.join(&name).to_string_lossy().into_owned();
    let confined = confine(&candidate, &plans_dir_s)?;
    let data = std::fs::read(&confined).map_err(|e| e.to_string())?;
    const MAX_PLAN_BYTES: usize = 2 << 20; // 2 MiB — plans are text
    let slice = if data.len() > MAX_PLAN_BYTES {
        &data[..MAX_PLAN_BYTES]
    } else {
        &data[..]
    };
    Ok(String::from_utf8_lossy(slice).into_owned())
}

/// Replaces the active binary with a backup's contents, preserving the current
/// active in trash. SSH-gated under `op`; mutes the watcher. Mirrors `RollbackBinary`.
#[tauri::command(rename_all = "camelCase")]
pub fn rollback_binary(
    active_path: String,
    backup_path: String,
    app: AppHandle,
    state: Maint,
) -> Result<TrashReceipt, String> {
    let _op = state.lock_op();
    state.ssh_gate()?;

    let effective = state.effective_root();
    if !is_active_binary(&effective, &active_path) {
        return Err(format!(
            "maintenance: {active_path:?} is not a currently-active binary"
        ));
    }
    let roots = state.resolve_roots()?;
    let app_data = state.app_data()?;
    let _mute = MuteGuard::new(&app);

    let trash_cl = |paths: &[String]| trash::trash_items(&roots, &app_data, paths);
    rollback_binary_fn(&roots, &app_data, &active_path, &backup_path, trash_cl)
}

/// Histogram + prunable counts for history.jsonl. Read-only: no SSH gate.
#[tauri::command(rename_all = "camelCase")]
pub fn analyze_history(state: Maint) -> Result<HistoryStats, String> {
    let root = state.effective_root();
    let cutoff = Utc::now() - Duration::days(state.history_cutoff_days());
    analyze_history_fn(&root, cutoff)
}

/// Ages-out history.jsonl older than `cutoff_days`, preserving the tail as a
/// restorable trash receipt. SSH-gated under `op`; mutes the watcher. Mirrors
/// `PruneHistory`.
#[tauri::command(rename_all = "camelCase")]
pub fn prune_history(cutoff_days: i64, app: AppHandle, state: Maint) -> Result<TrashReceipt, String> {
    let _op = state.lock_op();
    state.ssh_gate()?;

    state.config.set_maintenance_cutoff("history", cutoff_days)?;
    let days = state.history_cutoff_days();
    let root = state.effective_root();
    let roots = state.resolve_roots()?;
    let app_data = state.app_data()?;
    let _mute = MuteGuard::new(&app);

    let cutoff = Utc::now() - Duration::days(days);
    let history_path = Path::new(&root)
        .join("history.jsonl")
        .to_string_lossy()
        .into_owned();
    let trash_cl = |paths: &[String]| trash::trash_items(&roots, &app_data, paths);
    prune_history_fn(&app_data, &history_path, cutoff, trash_cl)
}

/// Irreversibly plain-deletes (or truncates) the given paths. SSH-gated under
/// `op`; mutes the watcher for the batch. Mirrors `ClearFiles`.
#[tauri::command(rename_all = "camelCase")]
pub fn clear_files(
    paths: Vec<String>,
    truncate: bool,
    app: AppHandle,
    state: Maint,
) -> Result<(), String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let roots = state.resolve_roots()?;
    let app_data = state.app_data()?;
    let _mute = MuteGuard::new(&app);
    clear_files_fn(&roots, &app_data, &paths, truncate)
}

/// Read-only health snapshot, with the scheduler status + app-own last-auto-cleanup
/// layered on from config. No SSH gate. Mirrors `GetMaintenanceHealth`.
#[tauri::command(rename_all = "camelCase")]
pub fn get_maintenance_health(state: Maint) -> Result<HealthStatus, String> {
    let mut h = maintenance_health(&state.effective_root())?;
    h.scheduler_interval = state.config.get_retention_policy().schedule_interval;
    h.last_auto_cleanup_ms = state.config.get_last_cleanup_ms();
    Ok(h)
}

/// Read-only: no gate.
#[tauri::command(rename_all = "camelCase")]
pub fn list_settings_generations() -> Result<Vec<String>, String> {
    list_gens()
}

/// Read-only: no gate.
#[tauri::command(rename_all = "camelCase")]
pub fn read_settings_generation(name: String) -> Result<String, String> {
    read_gen(&name)
}

/// Overwrites settings.json with a chosen generation. SSH-gated + serialized
/// under `op`. Does NOT mute (matches Go). Mirrors `RestoreSettingsGeneration`.
#[tauri::command(rename_all = "camelCase")]
pub fn restore_settings_generation(name: String, state: Maint) -> Result<(), String> {
    state.gated(|_root| restore_gen(&name))
}

/// Cancels the in-flight scan/policy run, if any. No-op otherwise.
#[tauri::command(rename_all = "camelCase")]
pub fn cancel_scan(state: Maint) -> Result<(), String> {
    state.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// Moves paths into the trash, muting the watcher for the batch and evicting the
/// SessionCache for any trashed project dirs. SSH-gated under `op`. Mirrors
/// `TrashItems`.
#[tauri::command(rename_all = "camelCase")]
pub fn trash_items(paths: Vec<String>, app: AppHandle, state: Maint) -> Result<TrashReceipt, String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let roots = state.resolve_roots()?;
    let app_data = state.app_data()?;
    let _mute = MuteGuard::new(&app);

    // The ported `trash_items` returns Err (not a partial receipt) on a mid-batch
    // failure, so eviction runs only on success — unlike Go, which evicts off the
    // partial receipt. The moved files' manifest is still persisted on disk.
    let receipt = trash::trash_items(&roots, &app_data, &paths)?;
    state.evict_trashed_projects(&app, &receipt);
    Ok(receipt)
}

/// Lists every trash receipt. Read-only: no SSH gate, no mutex.
#[tauri::command(rename_all = "camelCase")]
pub fn list_trash(state: Maint) -> Result<Vec<TrashReceipt>, String> {
    let app_data = state.app_data()?;
    list_trash_fn(&app_data)
}

/// Restores every item in `id` to its original location. SSH-gated under `op`;
/// does NOT mute (matches Go). Mirrors `RestoreTrash`.
#[tauri::command(rename_all = "camelCase")]
pub fn restore_trash(id: String, state: Maint) -> Result<(), String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let roots = state.resolve_roots()?;
    let app_data = state.app_data()?;
    restore_trash_fn(&roots, &app_data, &id)
}

/// Permanently deletes the given receipts. SSH-gated under `op`; does NOT mute
/// (matches Go). Mirrors `EmptyTrash`.
#[tauri::command(rename_all = "camelCase")]
pub fn empty_trash(ids: Vec<String>, state: Maint) -> Result<(), String> {
    let _op = state.lock_op();
    state.ssh_gate()?;
    let app_data = state.app_data()?;
    empty_trash_fn(&app_data, &ids)
}
