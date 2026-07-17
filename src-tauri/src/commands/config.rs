//! Tauri command wrappers for `ConfigService` (W12). Each mirrors a Go
//! `configservice` method 1:1; the managed `Arc<ConfigState>` is the persisted
//! store. `config_update` additionally syncs the OS autostart registration when
//! the general section changes (Go `syncAutostart`).

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::State;
use tauri_plugin_autostart::ManagerExt;

use crate::config::root::ClaudeRootInfo;
use crate::config::state::types::{
    AnnotationEntry, AnnotationExportBundle, AppConfig, BookmarkEntry, FilterPreset, ImportReport,
    NotificationTrigger,
};
use crate::config::state::{new_uuid, ConfigState};

type Cfg<'a> = State<'a, Arc<ConfigState>>;

/// Go `nowMS() = time.Now().UnixNano() / 1e6`.
fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as f64 / 1e6)
        .unwrap_or(0.0)
}

/// Syncs the OS launch-at-login entry; non-fatal, mirrors Go `syncAutostart`.
pub fn sync_autostart(app: &tauri::AppHandle, enable: bool) {
    let mgr = app.autolaunch();
    let res = if enable { mgr.enable() } else { mgr.disable() };
    if let Err(e) = res {
        eprintln!("autostart sync failed: {e}");
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_get(state: Cfg) -> Result<AppConfig, String> {
    Ok(state.get_config())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_update(
    section: String,
    data: Value,
    app: tauri::AppHandle,
    state: Cfg,
) -> Result<AppConfig, String> {
    let result = state.update_config(&section, data)?;
    if section == "general" {
        sync_autostart(&app, result.general.launch_at_login);
    }
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_add_ignore_regex(pattern: String, state: Cfg) -> Result<AppConfig, String> {
    state.add_ignore_regex(&pattern)
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_remove_ignore_regex(pattern: String, state: Cfg) -> Result<AppConfig, String> {
    Ok(state.remove_ignore_regex(&pattern))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_add_ignore_repository(repository_id: String, state: Cfg) -> Result<AppConfig, String> {
    state.add_ignore_repository(&repository_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_remove_ignore_repository(
    repository_id: String,
    state: Cfg,
) -> Result<AppConfig, String> {
    Ok(state.remove_ignore_repository(&repository_id))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_snooze(minutes: Option<u32>, state: Cfg) -> Result<AppConfig, String> {
    Ok(state.snooze(minutes))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_clear_snooze(state: Cfg) -> Result<AppConfig, String> {
    Ok(state.clear_snooze())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_add_trigger(trigger: NotificationTrigger, state: Cfg) -> Result<AppConfig, String> {
    state.add_trigger(trigger)
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_update_trigger(
    trigger_id: String,
    updates: Value,
    state: Cfg,
) -> Result<AppConfig, String> {
    state.update_trigger(&trigger_id, updates)
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_remove_trigger(trigger_id: String, state: Cfg) -> Result<AppConfig, String> {
    state.remove_trigger(&trigger_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_get_triggers(state: Cfg) -> Result<Vec<NotificationTrigger>, String> {
    Ok(state.get_triggers())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_pin_session(project_id: String, session_id: String, state: Cfg) -> Result<(), String> {
    state.pin_session(&project_id, &session_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_unpin_session(
    project_id: String,
    session_id: String,
    state: Cfg,
) -> Result<(), String> {
    state.unpin_session(&project_id, &session_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_hide_session(
    project_id: String,
    session_id: String,
    state: Cfg,
) -> Result<(), String> {
    state.hide_session(&project_id, &session_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_unhide_session(
    project_id: String,
    session_id: String,
    state: Cfg,
) -> Result<(), String> {
    state.unhide_session(&project_id, &session_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_hide_sessions(
    project_id: String,
    session_ids: Vec<String>,
    state: Cfg,
) -> Result<(), String> {
    state.hide_sessions(&project_id, &session_ids);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_unhide_sessions(
    project_id: String,
    session_ids: Vec<String>,
    state: Cfg,
) -> Result<(), String> {
    state.unhide_sessions(&project_id, &session_ids);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_get_claude_root_info(state: Cfg) -> Result<ClaudeRootInfo, String> {
    Ok(state.get_claude_root_info())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_open_in_editor(state: Cfg) -> Result<(), String> {
    let path = state.get_config_path();
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(&path);
        c
    } else if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("explorer");
        c.arg(&path);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&path);
        c
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open config file: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_add_bookmark(
    session_id: String,
    project_id: String,
    group_id: String,
    note: Option<String>,
    state: Cfg,
) -> Result<(), String> {
    state.add_bookmark(BookmarkEntry {
        id: new_uuid(),
        session_id,
        project_id,
        group_id,
        note,
        created_at: now_ms(),
    });
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_remove_bookmark(bookmark_id: String, state: Cfg) -> Result<(), String> {
    state.remove_bookmark(&bookmark_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_get_bookmarks(state: Cfg) -> Result<Vec<BookmarkEntry>, String> {
    Ok(state.get_bookmarks())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_add_annotation(
    session_id: String,
    project_id: String,
    target_id: String,
    text: String,
    color: String,
    state: Cfg,
) -> Result<AnnotationEntry, String> {
    let now = now_ms();
    let entry = AnnotationEntry {
        id: new_uuid(),
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

#[tauri::command(rename_all = "camelCase")]
pub fn config_update_annotation(
    annotation_id: String,
    text: Option<String>,
    color: Option<String>,
    state: Cfg,
) -> Result<bool, String> {
    Ok(state.update_annotation(&annotation_id, text.as_deref(), color.as_deref(), now_ms()))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_remove_annotation(annotation_id: String, state: Cfg) -> Result<(), String> {
    state.remove_annotation(&annotation_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_get_annotations(state: Cfg) -> Result<Vec<AnnotationEntry>, String> {
    Ok(state.get_annotations())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_set_session_tags(
    session_id: String,
    tags: Vec<String>,
    state: Cfg,
) -> Result<(), String> {
    state.set_session_tags(&session_id, tags);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_get_session_tags(session_id: String, state: Cfg) -> Result<Vec<String>, String> {
    Ok(state.get_session_tags(&session_id))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_create_group(name: String, state: Cfg) -> Result<bool, String> {
    Ok(state.create_session_group(&name))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_delete_group(name: String, state: Cfg) -> Result<(), String> {
    state.delete_session_group(&name);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_add_to_group(name: String, session_id: String, state: Cfg) -> Result<(), String> {
    state.add_to_session_group(&name, &session_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_remove_from_group(
    name: String,
    session_id: String,
    state: Cfg,
) -> Result<(), String> {
    state.remove_from_session_group(&name, &session_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_get_groups(state: Cfg) -> Result<std::collections::BTreeMap<String, Vec<String>>, String> {
    Ok(state.get_session_groups())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_add_filter_preset(
    name: String,
    filter: Value,
    state: Cfg,
) -> Result<FilterPreset, String> {
    let preset = FilterPreset {
        id: new_uuid(),
        name,
        filter,
        created_at: now_ms(),
    };
    state.add_filter_preset(preset.clone());
    Ok(preset)
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_remove_filter_preset(preset_id: String, state: Cfg) -> Result<(), String> {
    state.remove_filter_preset(&preset_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_rename_filter_preset(
    preset_id: String,
    name: String,
    state: Cfg,
) -> Result<bool, String> {
    Ok(state.rename_filter_preset(&preset_id, &name))
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_set_default_filter_preset(
    preset_id: Option<String>,
    state: Cfg,
) -> Result<(), String> {
    state.set_default_filter_preset(preset_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_export_annotations(session_ids: Vec<String>, state: Cfg) -> Result<String, String> {
    let bundle = state.export_annotations_bundle(&session_ids);
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn config_import_annotations(json_str: String, state: Cfg) -> Result<ImportReport, String> {
    let bundle: AnnotationExportBundle =
        serde_json::from_str(&json_str).map_err(|e| format!("Invalid bundle JSON: {e}"))?;
    Ok(state.import_annotations_bundle(bundle))
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_dismissed_suggestions(state: Cfg) -> Result<Vec<String>, String> {
    Ok(state.get_dismissed_suggestions())
}

#[tauri::command(rename_all = "camelCase")]
pub fn dismiss_suggestion(rule: String, state: Cfg) -> Result<(), String> {
    state.dismiss_suggestion(&rule)
}
