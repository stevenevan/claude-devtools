/// Tauri commands for config management.

use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::manager::ConfigState;
use super::types::{AnnotationEntry, AppConfig, BookmarkEntry, ClaudeRootInfo, NotificationTrigger};

type ConfigMutex = Arc<Mutex<ConfigState>>;

// Config CRUD

#[tauri::command]
pub fn config_get(config: tauri::State<'_, ConfigMutex>) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.get_config())
}

#[tauri::command]
pub fn config_update(
    section: String,
    data: Value,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.update_config(&section, &data)
}

// Ignore Regex

#[tauri::command]
pub fn config_add_ignore_regex(
    pattern: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.add_ignore_regex(&pattern)
}

#[tauri::command]
pub fn config_remove_ignore_regex(
    pattern: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.remove_ignore_regex(&pattern))
}

// Ignore Repository

#[tauri::command]
pub fn config_add_ignore_repository(
    repository_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.add_ignore_repository(&repository_id)
}

#[tauri::command]
pub fn config_remove_ignore_repository(
    repository_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.remove_ignore_repository(&repository_id))
}

// Snooze

#[tauri::command]
pub fn config_snooze(
    minutes: Option<u32>,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.snooze(minutes))
}

#[tauri::command]
pub fn config_clear_snooze(
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.clear_snooze())
}

// Triggers

#[tauri::command]
pub fn config_add_trigger(
    trigger: NotificationTrigger,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.add_trigger(trigger)
}

#[tauri::command]
pub fn config_update_trigger(
    trigger_id: String,
    updates: Value,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.update_trigger(&trigger_id, &updates)
}

#[tauri::command]
pub fn config_remove_trigger(
    trigger_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AppConfig, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.remove_trigger(&trigger_id)
}

#[tauri::command]
pub fn config_get_triggers(
    config: tauri::State<'_, ConfigMutex>,
) -> Result<Vec<NotificationTrigger>, String> {
    let state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.get_triggers())
}

// Session Pinning

#[tauri::command]
pub fn config_pin_session(
    project_id: String,
    session_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.pin_session(&project_id, &session_id);
    Ok(())
}

#[tauri::command]
pub fn config_unpin_session(
    project_id: String,
    session_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.unpin_session(&project_id, &session_id);
    Ok(())
}

// Session Hiding

#[tauri::command]
pub fn config_hide_session(
    project_id: String,
    session_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.hide_session(&project_id, &session_id);
    Ok(())
}

#[tauri::command]
pub fn config_unhide_session(
    project_id: String,
    session_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.unhide_session(&project_id, &session_id);
    Ok(())
}

#[tauri::command]
pub fn config_hide_sessions(
    project_id: String,
    session_ids: Vec<String>,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.hide_sessions(&project_id, &session_ids);
    Ok(())
}

#[tauri::command]
pub fn config_unhide_sessions(
    project_id: String,
    session_ids: Vec<String>,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.unhide_sessions(&project_id, &session_ids);
    Ok(())
}

// Claude Root Info

#[tauri::command]
pub fn config_get_claude_root_info(
    config: tauri::State<'_, ConfigMutex>,
) -> Result<ClaudeRootInfo, String> {
    let state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.get_claude_root_info())
}

// Open in Editor

#[tauri::command]
pub fn config_open_in_editor(
    config: tauri::State<'_, ConfigMutex>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let state = config.lock().map_err(|e| e.to_string())?;
    let path = state.get_config_path().to_string_lossy().to_string();
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| format!("Failed to open config file: {e}"))
}

// Bookmarks

#[tauri::command]
pub fn config_add_bookmark(
    session_id: String,
    project_id: String,
    group_id: String,
    note: Option<String>,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    state.add_bookmark(BookmarkEntry {
        id,
        session_id,
        project_id,
        group_id,
        note,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
            * 1000.0,
    });
    Ok(())
}

#[tauri::command]
pub fn config_remove_bookmark(
    bookmark_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.remove_bookmark(&bookmark_id);
    Ok(())
}

#[tauri::command]
pub fn config_get_bookmarks(
    config: tauri::State<'_, ConfigMutex>,
) -> Result<Vec<BookmarkEntry>, String> {
    let state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.get_bookmarks().to_vec())
}

// Annotations

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1000.0
}

#[tauri::command]
pub fn config_add_annotation(
    session_id: String,
    project_id: String,
    target_id: String,
    text: String,
    color: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<AnnotationEntry, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    let now = now_ms();
    let entry = AnnotationEntry {
        id: uuid::Uuid::new_v4().to_string(),
        session_id,
        project_id,
        target_id,
        text,
        color,
        created_at: now,
        updated_at: now,
    };
    state.add_annotation(entry.clone());
    Ok(entry)
}

#[tauri::command]
pub fn config_update_annotation(
    annotation_id: String,
    text: Option<String>,
    color: Option<String>,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<bool, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.update_annotation(&annotation_id, text, color, now_ms()))
}

#[tauri::command]
pub fn config_remove_annotation(
    annotation_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.remove_annotation(&annotation_id);
    Ok(())
}

#[tauri::command]
pub fn config_get_annotations(
    config: tauri::State<'_, ConfigMutex>,
) -> Result<Vec<AnnotationEntry>, String> {
    let state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.get_annotations().to_vec())
}

// Session Tags

#[tauri::command]
pub fn config_set_session_tags(
    session_id: String,
    tags: Vec<String>,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.set_session_tags(&session_id, tags);
    Ok(())
}

#[tauri::command]
pub fn config_get_session_tags(
    session_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<Vec<String>, String> {
    let state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.get_session_tags(&session_id))
}

// Session Groups

#[tauri::command]
pub fn config_create_group(
    name: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<bool, String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.create_session_group(&name))
}

#[tauri::command]
pub fn config_delete_group(
    name: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.delete_session_group(&name);
    Ok(())
}

#[tauri::command]
pub fn config_add_to_group(
    name: String,
    session_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.add_to_session_group(&name, &session_id);
    Ok(())
}

#[tauri::command]
pub fn config_remove_from_group(
    name: String,
    session_id: String,
    config: tauri::State<'_, ConfigMutex>,
) -> Result<(), String> {
    let mut state = config.lock().map_err(|e| e.to_string())?;
    state.remove_from_session_group(&name, &session_id);
    Ok(())
}

#[tauri::command]
pub fn config_get_groups(
    config: tauri::State<'_, ConfigMutex>,
) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    let state = config.lock().map_err(|e| e.to_string())?;
    Ok(state.get_session_groups().clone())
}
