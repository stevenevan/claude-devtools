//! Tauri command wrappers for the `cleanup.go` retention-policy surface plus the
//! closure wiring `runPolicyWith` injects into `maintenance::cleanup_run`. The
//! destructive closures (trash/empty/prune) re-lock `op` + re-check ssh so
//! package `maintenance` never imports the service layer; `RunPolicyClean` mutes
//! the watcher ONCE for the whole pass (the per-category trash closure does NOT
//! re-mute).

use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use chrono::{Duration, Utc};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use super::service::{enrich_spec, Maint};
use super::state::{now_ms, policy_cutoff_days, refuse_system_root, MaintenanceState, MuteGuard};
use crate::config::state::types::RetentionPolicy;
use crate::maintenance::cleanup_run::{
    run_policy, CombinedReport, PolicyError, RunPolicyOptions, TrashReceiptView,
};
use crate::maintenance::history::{analyze_history as analyze_history_fn, prune_history as prune_history_fn};
use crate::maintenance::trash::{self, empty_trash as empty_trash_fn, list_trash as list_trash_fn};
use crate::maintenance::types::CategorySpec;

/// Dry-run combined report. Read-only — no SSH gate, no run mutex. Mirrors
/// `PreviewPolicyClean`.
#[tauri::command(rename_all = "camelCase")]
pub fn preview_policy_clean(app: AppHandle, state: Maint) -> Result<CombinedReport, String> {
    let st = state.inner().clone();
    let policy = st.config.get_retention_policy();
    let (report, res) = run_policy_with(&st, &app, true, policy);
    finish(report, res)
}

/// Executes the retention policy through the SSH-gated executor. Mirrors
/// `RunPolicyClean`.
#[tauri::command(rename_all = "camelCase")]
pub fn run_policy_clean(app: AppHandle, state: Maint) -> Result<CombinedReport, String> {
    let st = state.inner().clone();
    let policy = st.config.get_retention_policy();
    run_policy_clean_with(&st, &app, policy)
}

/// Interrupts an in-flight policy run (or scan) between categories. Mirrors
/// `CancelPolicyClean`.
#[tauri::command(rename_all = "camelCase")]
pub fn cancel_policy_clean(state: Maint) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// The SOLE destructive policy path, shared by manual Clean-now and the
/// unattended scheduler: claim the run slot (reject-if-busy), up-front ssh gate,
/// mute ONCE, drive the policy, stamp last-run on success. Mirrors
/// `runPolicyCleanWith`.
pub(crate) fn run_policy_clean_with(
    state: &Arc<MaintenanceState>,
    app: &AppHandle,
    policy: RetentionPolicy,
) -> Result<CombinedReport, String> {
    let _run = state.claim_run("maintenance: a scan or cleanup is already in progress")?;
    // Up-front SSH gate (the per-category trash closure re-checks under `op`).
    state.ssh_gate()?;

    let _mute = MuteGuard::new(app);
    let (report, res) = run_policy_with(state, app, false, policy);
    if res.is_ok() {
        let _ = state.config.set_last_cleanup_ms(now_ms());
    }
    finish(report, res)
}

/// Maps the `(report, Result<(), PolicyError>)` pair to the command boundary:
/// a cancel surfaces as Go's `context.Canceled` string.
fn finish(report: CombinedReport, res: Result<(), PolicyError>) -> Result<CombinedReport, String> {
    match res {
        Ok(()) => Ok(report),
        Err(PolicyError::Cancelled) => Err("context canceled".to_string()),
        Err(PolicyError::Failed(e)) => Err(e),
    }
}

/// Resolves roots/policy/closures and drives `run_policy` in dry-run (preview) or
/// execute mode. The injected closures cross the boundary into pure
/// `maintenance::cleanup_run`. Mirrors `runPolicyWith`.
pub(crate) fn run_policy_with(
    state: &Arc<MaintenanceState>,
    app: &AppHandle,
    dry_run: bool,
    policy: RetentionPolicy,
) -> (CombinedReport, Result<(), PolicyError>) {
    let effective = state.effective_root();
    if let Err(e) = refuse_system_root(&effective) {
        return (CombinedReport::default(), Err(PolicyError::Failed(e)));
    }
    let app_data = match state.app_data() {
        Ok(a) => a,
        Err(e) => return (CombinedReport::default(), Err(PolicyError::Failed(e))),
    };
    let roots = match state.resolve_roots() {
        Ok(r) => r,
        Err(e) => return (CombinedReport::default(), Err(PolicyError::Failed(e))),
    };

    let cfg_for_cutoff = state.config.clone();
    let cutoff_for = Box::new(move |id: &str| policy_cutoff_days(&cfg_for_cutoff, id));

    let enrich_state = Arc::clone(state);
    let enrich_root = effective.clone();
    let enrich = Box::new(move |id: &str, spec: &mut CategorySpec| {
        enrich_spec(&enrich_state, id, &enrich_root, spec);
    });

    let prog_app = app.clone();
    let progress = Box::new(move |id: &str| {
        let _ = prog_app.emit("maintenance:scan-progress", json!({ "category": id }));
    });

    // policyTrash: re-lock `op` for the ssh-check + move (released between
    // categories so a cancel can interject); does NOT re-mute.
    let trash_state = Arc::clone(state);
    let trash_roots = roots.clone();
    let trash_app_data = app_data.clone();
    let trash_app = app.clone();
    let trash = Box::new(move |paths: &[String]| -> Result<(), String> {
        let _op = trash_state.lock_op();
        trash_state.ssh_gate()?;
        let receipt = trash::trash_items(&trash_roots, &trash_app_data, paths)?;
        trash_state.evict_trashed_projects(&trash_app, &receipt);
        Ok(())
    });

    let empty_state = Arc::clone(state);
    let empty_app_data = app_data.clone();
    let empty_trash = Box::new(move |ids: &[String]| -> Result<(), String> {
        let _op = empty_state.lock_op();
        empty_state.ssh_gate()?;
        empty_trash_fn(&empty_app_data, ids)
    });

    let list_app_data = app_data.clone();
    let list_trash = Box::new(move || -> Result<Vec<TrashReceiptView>, String> {
        let receipts = list_trash_fn(&list_app_data)?;
        Ok(receipts
            .into_iter()
            .map(|r| TrashReceiptView {
                id: r.id,
                trashed_at: r.trashed_at,
            })
            .collect())
    });

    // policyPruneHistory: "nothing older than the cutoff" is a no-op (count 0),
    // not a run failure.
    let prune_state = Arc::clone(state);
    let prune_roots = roots.clone();
    let prune_app_data = app_data.clone();
    let prune_effective = effective.clone();
    let prune_history = Box::new(move || -> Result<i64, String> {
        let _op = prune_state.lock_op();
        prune_state.ssh_gate()?;
        let cutoff = Utc::now() - Duration::days(prune_state.history_cutoff_days());
        let history_path = Path::new(&prune_effective)
            .join("history.jsonl")
            .to_string_lossy()
            .into_owned();
        let trash_cl = |paths: &[String]| trash::trash_items(&prune_roots, &prune_app_data, paths);
        match prune_history_fn(&prune_app_data, &history_path, cutoff, trash_cl) {
            Ok(receipt) => Ok(receipt.items.len() as i64),
            Err(e) if e.contains("nothing older than the cutoff") => Ok(0),
            Err(e) => Err(e),
        }
    });

    let analyze_state = Arc::clone(state);
    let analyze_effective = effective.clone();
    let analyze_history = Box::new(move || -> Result<i64, String> {
        let cutoff = Utc::now() - Duration::days(analyze_state.history_cutoff_days());
        let stats = analyze_history_fn(&analyze_effective, cutoff)?;
        Ok(stats.prunable_lines)
    });

    let opts = RunPolicyOptions {
        root: effective,
        app_data_dir: app_data,
        policy,
        now: Utc::now(),
        dry_run,
        cutoff_for,
        enrich: Some(enrich),
        progress: Some(progress),
        trash,
        empty_trash,
        list_trash,
        prune_history,
        analyze_history,
    };

    let cancel_flag = Arc::clone(&state.cancel);
    let cancelled = move || cancel_flag.load(Ordering::SeqCst);
    run_policy(&opts, &cancelled)
}
