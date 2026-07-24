//! Tauri command wrappers for `FilesService` (W12). Each mirrors a Go
//! `filesservice` method 1:1, delegating to the ported `crate::files::*` spine.
//! Read commands return zero-values on the internal error where Go swallows;
//! write commands propagate the sentinel/`files:` error strings verbatim.
//! Every `crate::files::*` fn is imported under an `_impl` alias so the command
//! name (the snake_case legacy contract) is free to match the Go method exactly.

use std::collections::HashMap;
use std::path::Path;

use serde_json::{Map, Value};

use crate::config::root::{app_data_dir, claude_dir};
use crate::files::agents_write::{read_agent_configs as read_agent_configs_impl, AgentConfig};
use crate::files::claude_read::{self, FileMeta};
use crate::files::filehistory_reader::{self, CheckpointGroup};
use crate::files::history_reader::{self, HistoryPage};
use crate::files::transcripts_reader::{self, TranscriptRecord};
use crate::files::claudejson::{
    list_claude_json_backups as list_backups_impl, read_claude_json as read_claude_json_impl,
    read_claude_json_backup as read_backup_impl, read_claude_json_masked as read_masked_impl,
    reveal_claude_json_value as reveal_value_impl, ClaudeJsonBackup, ClaudeJsonCensus,
};
use crate::files::claudejson_write::{
    list_claude_json_app_backups as list_app_backups_impl,
    purge_claude_json_projects as purge_impl,
    restore_claude_json_app_backup as restore_app_backup_impl, PurgeResult,
};
use crate::files::hooks_write::{read_hooks as read_hooks_impl, toggle_hook as toggle_hook_impl, HookView};
use crate::files::mcp_status::{get_mcp_status as get_mcp_status_impl, MCPStatusView};
use crate::files::pathutil::{
    read_claude_md_files as read_claude_md_impl, read_directory_claude_md as read_dir_md_impl,
    read_mentioned_file as read_mentioned_impl, validate_mentions as validate_mentions_impl,
    validate_path as validate_path_impl, ClaudeMdFile, MentionedFileResult, PathResult,
};
use crate::files::permissions_write::{
    add_permission_rule as add_rule_impl, get_permission_rules as get_rules_impl,
    move_permission_rule as move_rule_impl, remove_permission_rule as remove_rule_impl,
    PermissionRulesView, PermissionScope,
};
use crate::files::plugins_write::{
    dedupe_plugin as dedupe_impl, detect_plugin_duplicates as detect_dupes_impl,
    read_global_plugins as read_plugins_impl, set_plugin_enabled as set_plugin_impl,
    DuplicateGroup, Plugin,
};
use crate::files::settings_sources::{enumerate_settings_sources as enumerate_sources_impl, SourcesView};
use crate::files::settings_write::{
    read_global_settings as read_settings_impl, update_global_settings as update_settings_impl,
    SettingsPatch,
};
use crate::files::usage_reader;
use crate::insights::permissions_analyzer::{analyze_usage, Suggestion};

#[tauri::command(rename_all = "camelCase")]
pub fn validate_path(relative_path: String, project_path: String) -> Result<PathResult, String> {
    Ok(validate_path_impl(&relative_path, &project_path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn validate_mentions(
    mentions: Vec<Map<String, Value>>,
    project_path: String,
) -> Result<HashMap<String, bool>, String> {
    Ok(validate_mentions_impl(&mentions, &project_path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_claude_md_files(project_root: String) -> Result<HashMap<String, ClaudeMdFile>, String> {
    Ok(read_claude_md_impl(&project_root))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_directory_claude_md(dir_path: String) -> Result<ClaudeMdFile, String> {
    Ok(read_dir_md_impl(&dir_path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_mentioned_file(
    absolute_path: String,
    project_root: String,
    max_tokens: Option<i64>,
) -> Result<Option<MentionedFileResult>, String> {
    Ok(read_mentioned_impl(&absolute_path, &project_root, max_tokens))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_agent_configs(project_root: String) -> Result<HashMap<String, AgentConfig>, String> {
    Ok(read_agent_configs_impl(&project_root))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_global_plugins() -> Result<Vec<Plugin>, String> {
    read_plugins_impl()
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_global_settings() -> Result<Value, String> {
    read_settings_impl()
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_global_settings(patch: SettingsPatch) -> Result<(), String> {
    update_settings_impl(patch)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_hooks() -> Result<HookView, String> {
    let app_data = app_data_dir()?;
    read_hooks_impl(&app_data.to_string_lossy())
}

#[tauri::command(rename_all = "camelCase")]
pub fn toggle_hook(
    event: String,
    matcher_index: i64,
    fingerprint: String,
    enable: bool,
) -> Result<(), String> {
    let app_data = app_data_dir()?;
    toggle_hook_impl(
        &app_data.to_string_lossy(),
        &event,
        matcher_index,
        &fingerprint,
        enable,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_plugin_enabled(key: String, enable: bool) -> Result<(), String> {
    set_plugin_impl(&key, enable)
}

#[tauri::command(rename_all = "camelCase")]
pub fn dedupe_plugin(name: String, keep_key: String) -> Result<(), String> {
    dedupe_impl(&name, &keep_key)
}

#[tauri::command(rename_all = "camelCase")]
pub fn detect_plugin_duplicates() -> Result<Vec<DuplicateGroup>, String> {
    let plugins = read_plugins_impl()?;
    Ok(detect_dupes_impl(&plugins))
}

#[tauri::command(rename_all = "camelCase")]
pub fn enumerate_settings_sources(project_root: String) -> Result<SourcesView, String> {
    enumerate_sources_impl(&project_root)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_claude_json() -> Result<ClaudeJsonCensus, String> {
    read_claude_json_impl()
}

#[tauri::command(rename_all = "camelCase")]
pub fn reveal_claude_json_value(key_path: String) -> Result<String, String> {
    reveal_value_impl(&key_path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_claude_json_masked() -> Result<String, String> {
    read_masked_impl()
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_claude_json_backups() -> Result<Vec<ClaudeJsonBackup>, String> {
    list_backups_impl()
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_claude_json_backup(name: String) -> Result<String, String> {
    read_backup_impl(&name)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_mcp_status() -> Result<MCPStatusView, String> {
    get_mcp_status_impl()
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_permission_rules(project_root: String) -> Result<PermissionRulesView, String> {
    get_rules_impl(&project_root)
}

#[tauri::command(rename_all = "camelCase")]
pub fn add_permission_rule(
    scope: PermissionScope,
    list: String,
    rule: String,
) -> Result<(), String> {
    add_rule_impl(scope, &list, &rule)
}

#[tauri::command(rename_all = "camelCase")]
pub fn remove_permission_rule(
    scope: PermissionScope,
    list: String,
    rule: String,
) -> Result<(), String> {
    remove_rule_impl(scope, &list, &rule)
}

#[tauri::command(rename_all = "camelCase")]
pub fn move_permission_rule(
    from: PermissionScope,
    to: PermissionScope,
    from_list: String,
    to_list: String,
    rule: String,
) -> Result<(), String> {
    move_rule_impl(from, to, &from_list, &to_list, &rule)
}

#[tauri::command(rename_all = "camelCase")]
pub fn analyze_permission_suggestions(root: String) -> Result<Vec<Suggestion>, String> {
    Ok(analyze_usage(Path::new(&root)))
}

#[tauri::command(rename_all = "camelCase")]
pub fn purge_claude_json_projects(keys: Vec<String>) -> Result<PurgeResult, String> {
    purge_impl(&keys)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_claude_json_app_backups() -> Result<Vec<ClaudeJsonBackup>, String> {
    list_app_backups_impl()
}

#[tauri::command(rename_all = "camelCase")]
pub fn restore_claude_json_app_backup(name: String) -> Result<(), String> {
    restore_app_backup_impl(&name)
}

// ── read-only viewers (shell-snapshots) ──

#[tauri::command]
pub fn list_shell_snapshots() -> Result<Vec<FileMeta>, String> {
    let root = claude_dir()?;
    claude_read::list_dir_files(&root.to_string_lossy(), "shell-snapshots", "sh")
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_shell_snapshot(name: String) -> Result<String, String> {
    let root = claude_dir()?;
    let bytes = claude_read::read_confined_file(&root.to_string_lossy(), "shell-snapshots", &name)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// ── read-only viewers (usage/telemetry) ──

#[tauri::command]
pub fn read_usage_stats() -> Result<Value, String> {
    let root = claude_dir()?;
    usage_reader::read_usage_stats(&root.to_string_lossy())
}

#[tauri::command]
pub fn list_telemetry_events() -> Result<Vec<FileMeta>, String> {
    let root = claude_dir()?;
    claude_read::list_dir_files(&root.to_string_lossy(), "telemetry", "json")
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_telemetry_event(name: String) -> Result<Value, String> {
    let root = claude_dir()?;
    let bytes = claude_read::read_confined_file(&root.to_string_lossy(), "telemetry", &name)?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

// ── read-only viewers (file-history) ──

#[tauri::command]
pub fn list_file_history() -> Result<Vec<CheckpointGroup>, String> {
    let root = claude_dir()?;
    filehistory_reader::list_file_history(&root.to_string_lossy())
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_checkpoint(session_uuid: String, file_hash: String, version: u32) -> Result<String, String> {
    let root = claude_dir()?;
    filehistory_reader::read_checkpoint(&root.to_string_lossy(), &session_uuid, &file_hash, version)
}

// ── read-only viewers (history) ──

#[tauri::command(rename_all = "camelCase")]
pub fn read_history_page(
    before: Option<i64>,
    limit: usize,
    query: Option<String>,
) -> Result<HistoryPage, String> {
    let root = claude_dir()?;
    history_reader::read_history_page(&root.to_string_lossy(), before, limit, query.as_deref())
}

// ── read-only viewers (transcripts) ──

#[tauri::command]
pub fn list_transcripts() -> Result<Vec<FileMeta>, String> {
    let root = claude_dir()?;
    claude_read::list_dir_files(&root.to_string_lossy(), "transcripts", "jsonl")
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_transcript(id: String) -> Result<Vec<TranscriptRecord>, String> {
    let root = claude_dir()?;
    transcripts_reader::read_transcript(&root.to_string_lossy(), &id)
}
