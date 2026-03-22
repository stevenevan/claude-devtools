/// Tauri commands for notification CRUD and trigger testing.

use std::sync::{Arc, Mutex};

use tauri::Emitter;

use crate::cache::SessionCache;
use crate::config::manager::ConfigState;
use crate::config::types::NotificationTrigger;

use super::manager::NotificationState;
use super::trigger_tester;
use super::types::{GetNotificationsOptions, GetNotificationsResult, TriggerTestResult};

/// Type alias for managed notification state.
pub type NotificationMutex = Mutex<NotificationState>;

// =============================================================================
// CRUD Commands
// =============================================================================

#[tauri::command]
pub fn notifications_get(
    options: Option<GetNotificationsOptions>,
    state: tauri::State<'_, NotificationMutex>,
) -> Result<GetNotificationsResult, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.get_notifications(options))
}

#[tauri::command]
pub fn notifications_mark_read(
    id: String,
    state: tauri::State<'_, NotificationMutex>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let result = guard.mark_read(&id);
    if result {
        let _ = app.emit("notification:updated", guard.updated_payload());
    }
    Ok(result)
}

#[tauri::command]
pub fn notifications_mark_all_read(
    state: tauri::State<'_, NotificationMutex>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let result = guard.mark_all_read();
    let _ = app.emit("notification:updated", guard.updated_payload());
    Ok(result)
}

#[tauri::command]
pub fn notifications_delete(
    id: String,
    state: tauri::State<'_, NotificationMutex>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let result = guard.delete_notification(&id);
    if result {
        let _ = app.emit("notification:updated", guard.updated_payload());
    }
    Ok(result)
}

#[tauri::command]
pub fn notifications_clear(
    state: tauri::State<'_, NotificationMutex>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let result = guard.clear_all();
    let _ = app.emit("notification:updated", guard.updated_payload());
    Ok(result)
}

#[tauri::command]
pub fn notifications_get_unread_count(
    state: tauri::State<'_, NotificationMutex>,
) -> Result<usize, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.unread_count())
}

// =============================================================================
// Trigger Testing
// =============================================================================

#[tauri::command]
pub fn notifications_test_trigger(
    trigger: NotificationTrigger,
    limit: Option<usize>,
) -> Result<TriggerTestResult, String> {
    Ok(trigger_tester::test_trigger(&trigger, limit))
}

// =============================================================================
// Error Detection (called from watcher integration)
// =============================================================================

/// Run error detection for a session and add results to notification state.
/// Called from the watcher when a JSONL file changes.
pub fn detect_and_notify(
    app: &tauri::AppHandle,
    file_path: &str,
    project_id: &str,
    session_id: &str,
) -> Result<(), String> {
    use crate::parsing::session_parser;
    use super::error_detector::detect_errors;
    use tauri::Manager;

    let path = std::path::Path::new(file_path);
    let parsed = session_parser::parse_session_file(path)?;

    // Get enabled triggers from config
    let config_state = app.state::<Arc<Mutex<ConfigState>>>();
    let triggers = {
        let mut config = config_state.lock().map_err(|e| e.to_string())?;
        let cfg = config.get_config();
        cfg.notifications
            .triggers
            .into_iter()
            .filter(|t| t.enabled)
            .collect::<Vec<_>>()
    };

    if triggers.is_empty() {
        return Ok(());
    }

    let errors = detect_errors(
        &parsed.messages,
        session_id,
        project_id,
        file_path,
        &triggers,
    );

    if errors.is_empty() {
        return Ok(());
    }

    // Get notification config for native display decisions
    let (enabled, snoozed_until, ignored_regex, sound_enabled) = {
        let mut config = config_state.lock().map_err(|e| e.to_string())?;
        let cfg = config.get_config();
        (
            cfg.notifications.enabled,
            cfg.notifications.snoozed_until,
            cfg.notifications.ignored_regex.clone(),
            cfg.notifications.sound_enabled,
        )
    };

    let notif_state = app.state::<NotificationMutex>();
    let mut notif = notif_state.lock().map_err(|e| e.to_string())?;

    for error in errors {
        let should_native =
            notif.should_show_native(&error, enabled, snoozed_until, &ignored_regex);

        if let Some(ref stored) = notif.add_error(error.clone()) {
            let _ = app.emit("notification:new", stored);
            let _ = app.emit("notification:updated", notif.updated_payload());

            if should_native {
                show_native_notification(app, &error, sound_enabled);
            }
        }
    }

    Ok(())
}

/// Show a native OS notification via tauri-plugin-notification.
fn show_native_notification(app: &tauri::AppHandle, error: &super::types::DetectedError, sound: bool) {
    use tauri_plugin_notification::NotificationExt;

    let body = if error.message.len() > 200 {
        &error.message[..200]
    } else {
        &error.message
    };

    let mut builder = app
        .notification()
        .builder()
        .title("Claude Code Error")
        .body(body);

    if sound {
        builder = builder.sound("default");
    }

    if let Err(e) = builder.show() {
        eprintln!("[notifications] Failed to show native notification: {e}");
    }
}
