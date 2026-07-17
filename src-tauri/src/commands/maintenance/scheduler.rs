//! The W13 in-app scheduler (`scheduler.go`): an opt-in ticker that runs the
//! retention policy UNATTENDED while the app is open. Only AUTO-APPROVED
//! categories execute (through the SAME ssh-gated executor `run_policy_clean`
//! uses); the rest become a pending notification. A missed schedule is caught on
//! first wake, ASYNC in the scheduler thread. Plain-delete ids never run.

use std::panic::AssertUnwindSafe;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, TimeZone, Utc};
use serde::Serialize;
use tauri::AppHandle;

use super::cleanup::{run_policy_clean_with, run_policy_with};
use super::service::Maint;
use super::state::MaintenanceState;
use crate::config::state::types::{RetentionCategory, RetentionPolicy};

/// How often the thread wakes to re-evaluate whether a run is due — coarse (the
/// due window is days); it only bounds catch-up latency. Mirrors `schedulerTick`.
const SCHEDULER_TICK: StdDuration = StdDuration::from_secs(60 * 60);
/// Granularity at which the tick sleep checks the stop flag.
const STOP_POLL: StdDuration = StdDuration::from_secs(1);

/// Read-only scheduler snapshot. `last_run_ms` is 0 when a policy clean has never
/// run. Mirrors `ScheduleStatus`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleStatus {
    pub interval: String,
    pub last_run_ms: f64,
}

/// Current interval + last-run timestamp. Read-only. Mirrors `GetScheduleStatus`.
#[tauri::command(rename_all = "camelCase")]
pub fn get_schedule_status(state: Maint) -> Result<ScheduleStatus, String> {
    let policy = state.config.get_retention_policy();
    Ok(ScheduleStatus {
        interval: policy.schedule_interval,
        last_run_ms: state.config.get_last_cleanup_ms(),
    })
}

/// Launches the scheduler thread. Panic-guarded: a scan panic terminates the
/// thread cleanly (the app survives). Called from `main.rs` `setup`.
pub fn spawn_scheduler(app: AppHandle, state: Arc<MaintenanceState>) {
    thread::spawn(move || {
        let _ = std::panic::catch_unwind(AssertUnwindSafe(|| scheduler_loop(&app, &state)));
    });
}

/// Catch-up on first wake (the missed-run check run ASYNC, never inline in
/// startup), then re-check every tick until the stop flag is set. Mirrors
/// `schedulerLoop`.
fn scheduler_loop(app: &AppHandle, state: &Arc<MaintenanceState>) {
    maybe_run_scheduled(app, state);
    loop {
        let mut slept = StdDuration::ZERO;
        while slept < SCHEDULER_TICK {
            if state.sched_stop.load(Ordering::SeqCst) {
                return;
            }
            thread::sleep(STOP_POLL);
            slept += STOP_POLL;
        }
        if state.sched_stop.load(Ordering::SeqCst) {
            return;
        }
        maybe_run_scheduled(app, state);
    }
}

/// Runs a scheduled clean iff the policy is due. Mirrors `maybeRunScheduled`.
fn maybe_run_scheduled(app: &AppHandle, state: &Arc<MaintenanceState>) {
    let policy = state.config.get_retention_policy();
    if !is_schedule_due(
        &policy.schedule_interval,
        state.config.get_last_cleanup_ms(),
        Utc::now(),
    ) {
        return;
    }
    if let Err(e) = run_scheduled_clean(app, state) {
        eprintln!("maintenance: scheduled cleanup skipped: {e}");
    }
}

/// One unattended pass: the auto-approved subset runs through the ssh-gated
/// executor; enabled-but-not-auto-approved categories become a pending report.
/// Mirrors `runScheduledClean`.
fn run_scheduled_clean(app: &AppHandle, state: &Arc<MaintenanceState>) -> Result<(), String> {
    let policy = state.config.get_retention_policy();
    let (auto_policy, pending_ids) = partition_scheduled_policy(&policy);

    if policy_has_enabled(&auto_policy) {
        run_policy_clean_with(state, app, auto_policy)?; // errSSHActive refuses the whole run
    }

    if !pending_ids.is_empty() {
        raise_pending_report(app, state, &policy, &pending_ids)?;
    }
    Ok(())
}

/// Dry-runs the pending categories to size the report, then raises the
/// pending-cleanup notification. W13 SEAM: `raise_pending` is a NO-OP closure
/// (wired in `main.rs`); W14 replaces it with the real NotificationService raise.
/// Mirrors `raisePendingReport`.
fn raise_pending_report(
    app: &AppHandle,
    state: &Arc<MaintenanceState>,
    policy: &RetentionPolicy,
    pending_ids: &[String],
) -> Result<(), String> {
    let pending_set: std::collections::BTreeSet<&String> = pending_ids.iter().collect();
    let mut pending_policy = RetentionPolicy {
        categories: std::collections::BTreeMap::new(),
        trash_expiry_days: policy.trash_expiry_days,
        schedule_interval: policy.schedule_interval.clone(),
    };
    for (id, cat) in &policy.categories {
        pending_policy.categories.insert(
            id.clone(),
            RetentionCategory {
                enabled: pending_set.contains(id),
                auto_approved: cat.auto_approved,
            },
        );
    }

    let (report, res) = run_policy_with(state, app, true, pending_policy); // dry-run only
    if let Err(e) = res {
        return Err(match e {
            crate::maintenance::cleanup_run::PolicyError::Cancelled => "context canceled".to_string(),
            crate::maintenance::cleanup_run::PolicyError::Failed(msg) => msg,
        });
    }
    let total_bytes: i64 = report.categories.iter().map(|c| c.bytes).sum();
    (state.raise_pending)(pending_ids, total_bytes)
}

// ── pure due-check + partition (unit-tested) ─────────────────────────────────

/// Maps an interval to its due window; "off"/unknown → never due. Mirrors
/// `scheduleDueDuration`.
pub(crate) fn schedule_due_duration(interval: &str) -> Option<Duration> {
    match interval {
        "weekly" => Some(Duration::days(7)),
        "monthly" => Some(Duration::days(30)),
        _ => None,
    }
}

/// Whether a scheduled run is due: "off" never fires; a never-run schedule
/// (`last_run_ms <= 0`) is due immediately; else due once `now - last >= window`.
/// Mirrors `isScheduleDue`.
pub(crate) fn is_schedule_due(interval: &str, last_run_ms: f64, now: DateTime<Utc>) -> bool {
    let Some(window) = schedule_due_duration(interval) else {
        return false;
    };
    if last_run_ms <= 0.0 {
        return true;
    }
    match Utc.timestamp_millis_opt(last_run_ms as i64).single() {
        Some(last) => now.signed_duration_since(last) >= window,
        None => false,
    }
}

/// Splits an enabled policy into (a) an auto-approved-only copy safe to run
/// unattended, and (b) the sorted ids enabled but NOT auto-approved (→ pending).
/// Plain-delete ids never appear in either. Mirrors `partitionScheduledPolicy`.
pub(crate) fn partition_scheduled_policy(policy: &RetentionPolicy) -> (RetentionPolicy, Vec<String>) {
    let mut auto = RetentionPolicy {
        categories: std::collections::BTreeMap::new(),
        trash_expiry_days: policy.trash_expiry_days,
        schedule_interval: policy.schedule_interval.clone(),
    };
    let mut pending: Vec<String> = Vec::new();
    for (id, cat) in &policy.categories {
        let runnable = cat.enabled && !is_plain_delete_policy_id(id);
        if runnable && cat.auto_approved {
            auto.categories.insert(
                id.clone(),
                RetentionCategory { enabled: true, auto_approved: true },
            );
        } else if runnable {
            auto.categories.insert(
                id.clone(),
                RetentionCategory { enabled: false, auto_approved: false },
            );
            pending.push(id.clone());
        } else {
            auto.categories.insert(
                id.clone(),
                RetentionCategory { enabled: false, auto_approved: cat.auto_approved },
            );
        }
    }
    pending.sort();
    (auto, pending)
}

pub(crate) fn policy_has_enabled(policy: &RetentionPolicy) -> bool {
    policy.categories.values().any(|c| c.enabled)
}

/// Mirrors `maintenance::is_plain_delete_id`: the irreversible ClearFiles
/// categories the reversible-trash policy must never govern.
pub(crate) fn is_plain_delete_policy_id(id: &str) -> bool {
    matches!(id, "logs" | "logs-daemon" | "caches")
}
