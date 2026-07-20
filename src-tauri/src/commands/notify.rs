//! Tauri command layer for `NotificationService` (W14). Ports the Go
//! `internal/notifyservice` surface — the 8 notification-store commands, trigger
//! testing, webhook test-send, the policy setter, `detect_and_notify`, and the
//! low-priority synthetic alerts (`raise_config_drift` + the internal
//! `raise_pending_cleanup` scheduler seam) — as thin wrappers over the ported
//! pure `crate::notifications::*` domain.
//!
//! Emits `notification:new` / `notification:updated` via `app.emit(...)` exactly
//! where Go's `emitEvent` does. `NotificationState` locks internally, so (unlike
//! Go's external `Lock()`/`Unlock()`) each call re-locks — the file watcher
//! drives `detect_and_notify` serially, matching `manager.rs`'s design.

use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

use crate::config::state::types::{AppConfig, NotificationTrigger};
use crate::config::state::ConfigState;
use crate::notifications::error_detector::detect_errors;
use crate::notifications::manager::NotificationState;
use crate::notifications::tokens::now_ms;
use crate::notifications::trigger_tester::test_trigger;
use crate::notifications::types::{
    create_detected_error, CreateDetectedErrorParams, GetNotificationsOptions,
    GetNotificationsResult, StoredNotification, TriggerTestResult,
};
use crate::notifications::webhook::{dispatch_webhook, HttpTransport, WebhookContext, WebhookEndpoint};

/// Managed state for the notification commands: the persisted store + the shared
/// config manager (for the policy setter). Mirrors Go `NotificationService`'s
/// `state` + `config` fields.
pub struct NotifyState {
    pub state: Arc<NotificationState>,
    pub config: Arc<ConfigState>,
}

pub(crate) type Notify<'a> = State<'a, NotifyState>;

/// Fires a desktop toast via the notification plugin. Body capped at 200 chars
/// (char-boundary safe; Go's `beeep` cuts 200 bytes). The `show()` Result is
/// ignored, mirroring Go's `_ = beeep.Notify(...)`.
fn show_native_notification(app: &AppHandle, stored: &StoredNotification) {
    let mut body = stored.error.message.clone();
    if body.len() > 200 {
        let mut end = 200;
        while !body.is_char_boundary(end) {
            end -= 1;
        }
        body.truncate(end);
    }
    let _ = app
        .notification()
        .builder()
        .title("Claude Code Error")
        .body(body)
        .show();
}

/// `filepath.Base` equivalent for the drift message (empty → ".").
fn file_base(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string())
}

// ── State ────────────────────────────────────────────────────────────────────

/// Whether the notification engine is active (always true). Mirrors `GetState`.
#[tauri::command(rename_all = "camelCase")]
pub fn get_state() -> Result<bool, String> {
    Ok(true)
}

// ── 8 store commands ─────────────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub fn notifications_get(
    options: Option<GetNotificationsOptions>,
    notify: Notify,
) -> Result<GetNotificationsResult, String> {
    Ok(notify.state.get_notifications(options))
}

#[tauri::command(rename_all = "camelCase")]
pub fn notifications_mark_read(id: String, app: AppHandle, notify: Notify) -> Result<bool, String> {
    let result = notify.state.mark_read(&id);
    if result {
        let _ = app.emit("notification:updated", notify.state.updated_payload());
    }
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn notifications_mark_all_read(app: AppHandle, notify: Notify) -> Result<bool, String> {
    let result = notify.state.mark_all_read();
    let _ = app.emit("notification:updated", notify.state.updated_payload());
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn notifications_delete(id: String, app: AppHandle, notify: Notify) -> Result<bool, String> {
    let result = notify.state.delete_notification(&id);
    if result {
        let _ = app.emit("notification:updated", notify.state.updated_payload());
    }
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn notifications_clear(app: AppHandle, notify: Notify) -> Result<bool, String> {
    let result = notify.state.clear_all();
    let _ = app.emit("notification:updated", notify.state.updated_payload());
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn notifications_get_unread_count(notify: Notify) -> Result<i64, String> {
    Ok(notify.state.unread_count() as i64)
}

#[tauri::command(rename_all = "camelCase")]
pub fn notifications_test_trigger(
    trigger: NotificationTrigger,
    limit: Option<usize>,
) -> Result<TriggerTestResult, String> {
    Ok(test_trigger(&trigger, limit))
}

/// Validates and fires a test webhook delivery. Mirrors `WebhookTestSend`.
#[tauri::command(rename_all = "camelCase")]
pub fn webhook_test_send(endpoint: WebhookEndpoint) -> Result<(), String> {
    let ctx = WebhookContext {
        session_id: "test-session".to_string(),
        tool: "Bash".to_string(),
        cost: 0.0123,
        summary: "Test webhook from claude-devtools".to_string(),
    };
    let transport = HttpTransport::new();
    dispatch_webhook(&transport, &endpoint, &ctx).map_err(|e| e.to_string())
}

// ── Policy ───────────────────────────────────────────────────────────────────

/// Persists the auto-prune bounds and applies them live. Returns the clamped
/// `[retentionDays, maxCount]`. Mirrors `SetNotificationPolicy`.
#[tauri::command(rename_all = "camelCase")]
pub fn set_notification_policy(
    retention_days: i64,
    max_count: i64,
    notify: Notify,
) -> Result<Vec<i64>, String> {
    let (rd, mc) = notify.config.set_notification_policy(retention_days, max_count)?;
    notify.state.set_policy(rd, mc);
    Ok(vec![rd, mc])
}

// ── Detection + native notification ──────────────────────────────────────────

/// Runs error detection for a changed JSONL file and stores/emits results.
/// Mirrors `DetectAndNotify`.
#[tauri::command(rename_all = "camelCase")]
pub fn detect_and_notify(
    file_path: String,
    project_id: String,
    session_id: String,
    cfg: AppConfig,
    app: AppHandle,
    notify: Notify,
) -> Result<(), String> {
    let triggers: Vec<NotificationTrigger> = cfg
        .notifications
        .triggers
        .iter()
        .filter(|t| t.enabled)
        .cloned()
        .collect();
    if triggers.is_empty() {
        return Ok(());
    }

    let (messages, _) = crate::parsing::session_parser::parse_jsonl_file(Path::new(&file_path))?;
    let errors = detect_errors(&messages, &session_id, &project_id, &file_path, &triggers);
    if errors.is_empty() {
        return Ok(());
    }

    let notif_enabled = cfg.notifications.enabled;
    let snoozed_until = cfg.notifications.snoozed_until;
    let ignored_regex = &cfg.notifications.ignored_regex;

    for e in errors {
        let should_native =
            notify
                .state
                .should_show_native(&e, notif_enabled, snoozed_until, ignored_regex);
        if let Some(stored) = notify.state.add_error(e) {
            let _ = app.emit("notification:new", &stored);
            let _ = app.emit("notification:updated", notify.state.updated_payload());
            if should_native {
                show_native_notification(&app, &stored);
            }
        }
    }
    Ok(())
}

// ── Low-priority synthetic alerts (config drift + pending cleanup) ────────────

/// Raises a low-priority "config changed externally" alert. The synthetic
/// `config-drift:<file>:<hourBucket>` ToolUseID dedups the CLI's constant
/// same-hour rewrites (AddError dedups only by exact ToolUseID). Mirrors
/// `RaiseConfigDrift`.
#[tauri::command(rename_all = "camelCase")]
pub fn raise_config_drift(
    file: String,
    hour_bucket: i64,
    key_count: i64,
    app: AppHandle,
    notify: Notify,
) -> Result<(), String> {
    let msg = format!("{} changed externally: {} keys", file_base(&file), key_count);
    let tool_use_id = format!("config-drift:{file}:{hour_bucket}");
    raise_synthetic_alert(&app, &notify.state, "config-drift", &msg, &file, tool_use_id);
    Ok(())
}

/// Builds a `DetectedError` with a synthetic dedup key and routes it through the
/// same `add_error` + emit path `detect_and_notify` uses (no native toast — these
/// are low-priority in-app alerts). Mirrors `raiseSyntheticAlert`.
fn raise_synthetic_alert(
    app: &AppHandle,
    state: &NotificationState,
    source: &str,
    message: &str,
    file_path: &str,
    tool_use_id: String,
) {
    let e = create_detected_error(CreateDetectedErrorParams {
        source: source.to_string(),
        message: message.to_string(),
        file_path: file_path.to_string(),
        timestamp_ms: now_ms(),
        tool_use_id: Some(tool_use_id),
        ..Default::default()
    });
    if let Some(stored) = state.add_error(e) {
        let _ = app.emit("notification:new", &stored);
        let _ = app.emit("notification:updated", state.updated_payload());
    }
}

/// Raises the "scheduled cleanup needs approval" alert for the unattended
/// scheduler seam (Go's `RaisePendingCleanup`). NOT a command — invoked by the
/// `MaintenanceState` `raise_pending` closure wired in `main.rs`. The synthetic
/// `cleanup-pending:<sorted cats>:<hourBucket>` ToolUseID dedups repeated
/// same-hour passes. No `app.emit` — the closure is built before the `AppHandle`
/// exists, so the store is updated (with dedup) and the alert surfaces on the
/// next `notifications_get` (the live event is deferred vs. Go).
pub fn raise_pending_cleanup(state: &NotificationState, categories: &[String], total_bytes: i64) {
    let mut sorted: Vec<String> = categories.to_vec();
    sorted.sort();
    let hour_bucket = (now_ms() / 3_600_000.0) as i64;
    let tool_use_id = format!("cleanup-pending:{}:{}", sorted.join(","), hour_bucket);
    let msg = format!(
        "Scheduled cleanup needs approval: {} categories ({} bytes pending)",
        sorted.len(),
        total_bytes
    );
    let e = create_detected_error(CreateDetectedErrorParams {
        source: "cleanup-pending".to_string(),
        message: msg,
        timestamp_ms: now_ms(),
        tool_use_id: Some(tool_use_id),
        ..Default::default()
    });
    let _ = state.add_error(e);
}
