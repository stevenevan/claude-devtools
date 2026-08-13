//! Tauri command wrappers for `FilesService` (W12). Each mirrors a Go
//! `filesservice` method 1:1, delegating to the ported `crate::files::*` spine.
//! Read commands return zero-values on the internal error where Go swallows;
//! write commands propagate the sentinel/`files:` error strings verbatim.
//! Every `crate::files::*` fn is imported under an `_impl` alias so the command
//! name (the snake_case legacy contract) is free to match the Go method exactly.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::config::root::{app_data_dir, claude_dir};
use crate::files::agents_write::{read_agent_configs as read_agent_configs_impl, AgentConfig};
use crate::files::checkpoint_origin::{self, CheckpointOrigin};
use crate::files::claude_read::{self, FileMeta};
use crate::files::codex_reader::{self, InspectorEvent, InspectorHistoryEntry, InspectorPage, InspectorTaskGraphList, InspectorTaskGraphMeta, InspectorTaskGraphResult, InspectorTranscriptMeta};
use crate::files::filehistory_reader::{self, CheckpointGroup};
use crate::files::history_reader::{self, HistoryPage};
use crate::files::marketplace_reader::{self, MarketplaceCatalog};
use crate::files::task_graph_reader::{self, TaskGraphMeta, TaskNode};
use crate::files::transcripts_reader::{self, TranscriptRecord};
use crate::files::claudejson::{
    list_claude_json_backups as list_backups_impl, read_claude_json as read_claude_json_impl,
    read_claude_json_backup as read_backup_impl, read_claude_json_masked as read_masked_impl,
    reveal_claude_json_value as reveal_value_impl, ClaudeJsonBackup, ClaudeJsonCensus,
};
use crate::files::claudejson_write::{
    add_global_mcp_server as add_mcp_server_impl, list_claude_json_app_backups as list_app_backups_impl,
    purge_claude_json_projects as purge_impl,
    remove_global_mcp_server as remove_mcp_server_impl,
    restore_claude_json_app_backup as restore_app_backup_impl,
    update_global_mcp_server as update_mcp_server_impl, PurgeResult,
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
use crate::files::statusline::{self, StatusLineConfig, StatusLineScriptInfo};
use crate::files::settings_write::{
    read_global_settings as read_settings_impl, update_global_settings as update_settings_impl,
    SettingsPatch,
};
use crate::files::usage_reader;
use crate::insights::permissions_analyzer::{analyze_usage, Suggestion};
use crate::types::source::{
    Diagnostic, Provenance, SourceCapabilities, SourceKind, SourceState, SourceStatus,
    TaskGraphCapability, TaskGraphCapabilityState,
};

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

// These three target the LOCAL ~/.claude.json and configure code Claude Code
// will spawn (MCP server commands/URLs) — any future network-exposed IPC MUST
// gate them.

#[tauri::command(rename_all = "camelCase")]
pub fn add_mcp_server(name: String, config: Value) -> Result<(), String> {
    add_mcp_server_impl(&name, config)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_mcp_server(name: String, patch: Value) -> Result<(), String> {
    update_mcp_server_impl(&name, patch)
}

#[tauri::command(rename_all = "camelCase")]
pub fn remove_mcp_server(name: String) -> Result<(), String> {
    remove_mcp_server_impl(&name)
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

/// The shared body of every checkpoint save: validate the ids, open the native
/// save dialog, and write the raw bytes to whatever the user picked. `aim`
/// pre-fills the dialog with an existing file's directory and name; `None`
/// leaves the dialog wherever it last was, with the opaque `{hash}@v{version}`
/// as the suggested name.
///
/// Returns the path actually written, or `None` when the user cancelled.
///
/// This is the ONE place the dialog is configured, so a guard added here covers
/// both save-as and restore. `async` is load-bearing: the blocking dialog must
/// run off the main thread or it deadlocks the event loop (same reason as
/// `configbackup::export_backup`).
async fn save_checkpoint_via_dialog(
    app: AppHandle,
    session_uuid: &str,
    file_hash: &str,
    version: u32,
    aim: Option<&Path>,
    title: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    // Before the ids are used for ANYTHING, including the suggested filename.
    filehistory_reader::validate_ids(session_uuid, file_hash)?;
    let root = claude_dir()?;

    let mut builder = app.dialog().file();
    match aim.and_then(|path| path.parent().zip(path.file_name())) {
        Some((parent, name)) => {
            builder = builder
                .set_directory(parent)
                .set_file_name(name.to_string_lossy());
        }
        None => builder = builder.set_file_name(format!("{file_hash}@v{version}")),
    }
    if let Some(title) = title {
        builder = builder.set_title(title);
    }

    let Some(file_path) = builder.blocking_save_file() else {
        return Ok(None); // user cancel — no-op
    };
    let dest = file_path.into_path().map_err(|e| e.to_string())?;

    filehistory_reader::export_checkpoint_to(
        &root.to_string_lossy(),
        session_uuid,
        file_hash,
        version,
        &dest,
    )?;
    Ok(Some(dest))
}

/// Saves one checkpoint to a path the user picks in the native save dialog.
/// Returns whether a file was written — `false` means the user cancelled, so
/// the UI does not claim "Saved".
#[tauri::command(rename_all = "camelCase")]
pub async fn export_checkpoint(
    session_uuid: String,
    file_hash: String,
    version: u32,
    app: AppHandle,
) -> Result<bool, String> {
    let written =
        save_checkpoint_via_dialog(app, &session_uuid, &file_hash, version, None, None).await?;
    Ok(written.is_some())
}

/// Where a checkpoint's bytes came from, for display and to decide whether the
/// Restore action is offered at all. Read-only.
#[tauri::command(rename_all = "camelCase")]
pub fn resolve_checkpoint_origin(
    session_uuid: String,
    file_hash: String,
) -> Result<Option<CheckpointOrigin>, String> {
    let root = claude_dir()?;
    checkpoint_origin::resolve_checkpoint_origin(
        &root.to_string_lossy(),
        &session_uuid,
        &file_hash,
    )
}

/// Saves one checkpoint back over the file it was captured from, with the save
/// dialog pre-aimed at that path so the user confirms the overwrite natively.
///
/// The origin is re-resolved HERE rather than accepted from the renderer, so no
/// caller-supplied value can steer the write. Returns the path actually
/// written, which may differ from the origin if the user navigated elsewhere in
/// the dialog — the UI must not claim a restore over a file never touched.
#[tauri::command(rename_all = "camelCase")]
pub async fn restore_checkpoint(
    session_uuid: String,
    file_hash: String,
    version: u32,
    app: AppHandle,
) -> Result<Option<String>, String> {
    filehistory_reader::validate_ids(&session_uuid, &file_hash)?;
    let root = claude_dir()?;

    let origin = checkpoint_origin::resolve_checkpoint_origin(
        &root.to_string_lossy(),
        &session_uuid,
        &file_hash,
    )?
    .ok_or("files: original path for this checkpoint is unknown")?;

    let written = save_checkpoint_via_dialog(
        app,
        &session_uuid,
        &file_hash,
        version,
        Some(Path::new(&origin.real_path)),
        Some("Restore checkpoint"),
    )
    .await?;
    Ok(written.map(|path| path.to_string_lossy().into_owned()))
}

// ── status line config ──

#[tauri::command(rename_all = "camelCase")]
pub fn read_status_line() -> Result<Option<StatusLineConfig>, String> {
    statusline::read_status_line()
}

/// Persists the `statusLine` object, or removes it when `config` is `None`.
/// Validated here at the IPC boundary before it reaches the writer.
#[tauri::command(rename_all = "camelCase")]
pub fn update_status_line(config: Option<StatusLineConfig>) -> Result<(), String> {
    if let Some(cfg) = &config {
        statusline::validate(cfg)?;
    }
    statusline::write_status_line(config)
}

/// Metadata about the script `command` points at — never its content, and
/// never executed.
#[tauri::command(rename_all = "camelCase")]
pub fn stat_status_line_script(command: String) -> Result<StatusLineScriptInfo, String> {
    let root = claude_dir()?;
    Ok(statusline::stat_status_line_script(&command, &root))
}

/// Reveals the script in the OS file manager. Reveal, not open: a real
/// `status-line` can be a Mach-O binary, which `open` would execute.
#[tauri::command(rename_all = "camelCase")]
pub fn reveal_status_line_script(command: String) -> Result<(), String> {
    let root = claude_dir()?;
    statusline::reveal_status_line_script(&command, &root)
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

// ── read-only viewers (marketplace) ──

#[tauri::command]
pub fn read_marketplace_catalog() -> Result<MarketplaceCatalog, String> {
    let root = claude_dir()?;
    marketplace_reader::read_marketplace_catalog(&root.to_string_lossy())
}

// ── read-only viewers (task-graph) ──

#[tauri::command]
pub fn list_task_graphs() -> Result<Vec<TaskGraphMeta>, String> {
    let root = claude_dir()?;
    task_graph_reader::list_task_graphs(&root.to_string_lossy())
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_task_graph(uuid: String) -> Result<Vec<TaskNode>, String> {
    let root = claude_dir()?;
    task_graph_reader::read_task_graph(&root.to_string_lossy(), &uuid)
}

// ── source-aware inspector viewers ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceCursor {
    version: u8,
    source: SourceKind,
    operation: String,
    revision: String,
    offset: usize,
    before: Option<i64>,
    id: Option<String>,
}

#[tauri::command]
pub fn get_inspector_sources() -> Result<Vec<SourceStatus>, String> {
    Ok(vec![claude_source_status(), crate::config::root::get_codex_source_status()])
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_source_history_page(
    source_kind: SourceKind,
    cursor: Option<String>,
    limit: usize,
    query: Option<String>,
) -> Result<InspectorPage<InspectorHistoryEntry>, String> {
    validate_source_cursor(cursor.as_deref())?;
    validate_source_query(query.as_deref())?;
    if source_kind == SourceKind::Codex {
        return codex_reader::read_history_page(cursor.as_deref(), limit, query.as_deref());
    }
    let limit = validate_source_limit(limit)?;
    let root = claude_dir()?;
    let revision = crate::config::root::source_revision(&root).unwrap_or_else(|| "unknown".to_string());
    let cursor = decode_source_cursor(cursor.as_deref(), SourceKind::Claude, "history", &revision, None)?;
    let page = history_reader::read_history_page(
        &root.to_string_lossy(),
        cursor.before,
        limit,
        query.as_deref(),
    )?;
    let entries = page
        .entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| InspectorHistoryEntry {
            session_id: None,
            display: entry.display,
            project: entry.project,
            timestamp: Some(entry.timestamp),
            pasted_count: entry.pasted_count,
            source: SourceKind::Claude,
            provenance: Provenance {
                source_file: "history.jsonl".to_string(),
                line: Some(index + 1),
                archived: false,
            },
        })
        .collect::<Vec<_>>();
    let next_cursor = page.has_more.then(|| {
        let before = entries.last().and_then(|entry| entry.timestamp);
        encode_source_cursor(&SourceCursor {
            version: 1,
            source: SourceKind::Claude,
            operation: "history".to_string(),
            revision: revision.clone(),
            offset: 0,
            before,
            id: None,
        })
    });
    Ok(InspectorPage {
        items: entries,
        next_cursor,
        has_more: page.has_more,
        total_matched: Some(page.total_matched),
        scan_limited: false,
        diagnostics: Vec::new(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_source_transcripts(
    source_kind: SourceKind,
    cursor: Option<String>,
    limit: usize,
) -> Result<InspectorPage<InspectorTranscriptMeta>, String> {
    validate_source_cursor(cursor.as_deref())?;
    if source_kind == SourceKind::Codex {
        return codex_reader::list_transcripts(cursor.as_deref(), limit);
    }
    let limit = validate_source_limit(limit)?;
    let root = claude_dir()?;
    let revision = crate::config::root::source_revision(&root).unwrap_or_else(|| "unknown".to_string());
    let cursor = decode_source_cursor(cursor.as_deref(), SourceKind::Claude, "transcripts", &revision, None)?;
    let files = claude_read::list_dir_files(&root.to_string_lossy(), "transcripts", "jsonl")?;
    let items = files
        .into_iter()
        .map(|file| InspectorTranscriptMeta {
            id: file.name.clone(),
            label: file.name.clone(),
            size_bytes: u64::try_from(file.size_bytes).unwrap_or(0),
            mtime: Some(file.mtime),
            source: SourceKind::Claude,
            archived: false,
            provenance: Provenance {
                source_file: format!("transcripts/{}", file.name),
                line: None,
                archived: false,
            },
        })
        .collect::<Vec<_>>();
    let page_start = cursor.offset.min(items.len());
    let page_end = (page_start + limit).min(items.len());
    let has_more = page_end < items.len();
    let next_cursor = has_more.then(|| {
        encode_source_cursor(&SourceCursor {
            version: 1,
            source: SourceKind::Claude,
            operation: "transcripts".to_string(),
            revision: revision.clone(),
            offset: page_end,
            before: None,
            id: None,
        })
    });
    Ok(InspectorPage {
        items: items[page_start..page_end].to_vec(),
        next_cursor,
        has_more,
        total_matched: Some(items.len()),
        scan_limited: false,
        diagnostics: Vec::new(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_source_transcript(
    source_kind: SourceKind,
    id: String,
    cursor: Option<String>,
    limit: usize,
) -> Result<InspectorPage<InspectorEvent>, String> {
    read_source_transcript_impl(source_kind, id, cursor, limit)
}

fn read_source_transcript_impl(
    source_kind: SourceKind,
    id: String,
    cursor: Option<String>,
    limit: usize,
) -> Result<InspectorPage<InspectorEvent>, String> {
    validate_source_transcript_id(&id)?;
    validate_source_cursor(cursor.as_deref())?;
    validate_source_event_limit(limit)?;
    if source_kind == SourceKind::Codex {
        return codex_reader::read_transcript(&id, cursor.as_deref(), limit);
    }
    let limit = validate_source_limit(limit)?;
    let root = claude_dir()?;
    let revision = crate::config::root::source_revision(&root).unwrap_or_else(|| "unknown".to_string());
    let cursor = decode_source_cursor(cursor.as_deref(), SourceKind::Claude, "transcript", &revision, Some(&id))?;
    let records = transcripts_reader::read_transcript(&root.to_string_lossy(), &id)?;
    let events = records
        .into_iter()
        .enumerate()
        .map(|(index, record)| {
            let is_tool = record.tool_name.is_some();
            InspectorEvent {
                kind: record.kind.clone(),
                timestamp: record.timestamp,
                role: (record.kind == "user").then_some("user".to_string()),
                content: record.content,
                tool_name: record.tool_name,
                tool_id: None,
                tool_input_shape: is_tool.then_some("present".to_string()),
                tool_output_size: record.tool_output.as_ref().map(String::len),
                tool_status: None,
                truncated: record.truncated,
                provenance: Provenance {
                    source_file: format!("transcripts/{id}"),
                    line: Some(index + 1),
                    archived: false,
                },
            }
        })
        .collect::<Vec<_>>();
    let page_start = cursor.offset.min(events.len());
    let page_end = (page_start + limit).min(events.len());
    let has_more = page_end < events.len();
    let next_cursor = has_more.then(|| {
        encode_source_cursor(&SourceCursor {
            version: 1,
            source: SourceKind::Claude,
            operation: "transcript".to_string(),
            revision: revision.clone(),
            offset: page_end,
            before: None,
            id: Some(id.clone()),
        })
    });
    Ok(InspectorPage {
        items: events[page_start..page_end].to_vec(),
        next_cursor,
        has_more,
        total_matched: Some(events.len()),
        scan_limited: false,
        diagnostics: Vec::new(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_source_session(
    source_kind: SourceKind,
    id: String,
    cursor: Option<String>,
    limit: usize,
) -> Result<InspectorPage<InspectorEvent>, String> {
    if source_kind == SourceKind::Codex {
        validate_source_cursor(cursor.as_deref())?;
        validate_source_event_limit(limit)?;
        return codex_reader::read_session(&id, cursor.as_deref(), limit);
    }
    read_source_transcript_impl(source_kind, id, cursor, limit)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_source_task_graphs(
    source_kind: SourceKind,
) -> Result<InspectorTaskGraphList, String> {
    if source_kind == SourceKind::Codex {
        return codex_reader::list_task_graphs();
    }
    let root = claude_dir()?;
    let items = task_graph_reader::list_task_graphs(&root.to_string_lossy())?
        .into_iter()
        .map(|graph| InspectorTaskGraphMeta {
            id: graph.uuid,
            label: graph.label,
            task_count: graph.task_count,
            latest_mtime: graph.latest_mtime,
            source: SourceKind::Claude,
        })
        .collect();
    Ok(InspectorTaskGraphList {
        capability: claude_task_graph_capability(),
        items,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_source_task_graph(
    source_kind: SourceKind,
    id: String,
) -> Result<InspectorTaskGraphResult, String> {
    validate_source_task_graph_id(&id)?;
    if source_kind == SourceKind::Codex {
        return codex_reader::read_task_graph(&id);
    }
    let root = claude_dir()?;
    let nodes = task_graph_reader::read_task_graph(&root.to_string_lossy(), &id)?
        .into_iter()
        .filter_map(|node| serde_json::to_value(node).ok())
        .collect();
    Ok(InspectorTaskGraphResult {
        id,
        nodes,
        capability: claude_task_graph_capability(),
    })
}

fn validate_source_limit(limit: usize) -> Result<usize, String> {
    if limit == 0 || limit > codex_reader::MAX_PAGE_SIZE {
        return Err(format!(
            "limit must be between 1 and {}",
            codex_reader::MAX_PAGE_SIZE
        ));
    }
    Ok(limit)
}

fn validate_source_event_limit(limit: usize) -> Result<usize, String> {
    if limit == 0 || limit > codex_reader::MAX_EVENT_PAGE {
        return Err(format!(
            "limit must be between 1 and {}",
            codex_reader::MAX_EVENT_PAGE
        ));
    }
    Ok(limit)
}

fn validate_source_cursor(cursor: Option<&str>) -> Result<(), String> {
    if cursor.is_some_and(|cursor| cursor.len() > codex_reader::MAX_CURSOR_BYTES) {
        return Err("cursor is too large".to_string());
    }
    Ok(())
}

fn validate_source_query(query: Option<&str>) -> Result<(), String> {
    if query.is_some_and(|query| query.len() > codex_reader::MAX_QUERY_BYTES) {
        return Err("query exceeds the configured byte limit".to_string());
    }
    Ok(())
}

fn validate_source_transcript_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 512 || id.contains('\0') {
        return Err("source transcript id is invalid".to_string());
    }
    let path = Path::new(id);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("source transcript id must be a relative path".to_string());
    }
    Ok(())
}

fn validate_source_task_graph_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 512
        || id.contains('/')
        || id.contains('\\')
        || id.contains('\0')
    {
        return Err("source task graph id is invalid".to_string());
    }
    Ok(())
}

fn encode_source_cursor(cursor: &SourceCursor) -> String {
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(cursor).expect("source cursor serialization"))
}

fn decode_source_cursor(
    encoded: Option<&str>,
    source: SourceKind,
    operation: &str,
    revision: &str,
    id: Option<&str>,
) -> Result<SourceCursor, String> {
    let Some(encoded) = encoded else {
        return Ok(SourceCursor {
            version: 1,
            source,
            operation: operation.to_string(),
            revision: revision.to_string(),
            offset: 0,
            before: None,
            id: id.map(str::to_string),
        });
    };
    if encoded.len() > codex_reader::MAX_CURSOR_BYTES {
        return Err("cursor is too large".to_string());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "cursor is invalid".to_string())?;
    let cursor: SourceCursor = serde_json::from_slice(&bytes)
        .map_err(|_| "cursor is invalid".to_string())?;
    if cursor.version != 1
        || cursor.source != source
        || cursor.operation != operation
        || cursor.revision != revision
        || cursor.id.as_deref() != id
    {
        return Err("cursor is stale; reload the source".to_string());
    }
    Ok(cursor)
}

fn claude_source_status() -> SourceStatus {
    let root = match claude_dir() {
        Ok(root) => root,
        Err(reason) => {
            return SourceStatus {
                source_kind: SourceKind::Claude,
                state: SourceState::Invalid,
                label: "~/.claude".to_string(),
                revision: None,
                reason: Some(reason),
                capabilities: claude_capabilities(),
            }
        }
    };
    match fs::metadata(&root) {
        Ok(metadata) if metadata.is_dir() => SourceStatus {
            source_kind: SourceKind::Claude,
            state: SourceState::Available,
            label: "~/.claude".to_string(),
            revision: crate::config::root::source_revision(&root),
            reason: None,
            capabilities: claude_capabilities(),
        },
        Ok(_) => SourceStatus {
            source_kind: SourceKind::Claude,
            state: SourceState::Invalid,
            label: "~/.claude".to_string(),
            revision: None,
            reason: Some("Claude data root is not a directory".to_string()),
            capabilities: claude_capabilities(),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SourceStatus {
            source_kind: SourceKind::Claude,
            state: SourceState::NotFound,
            label: "~/.claude".to_string(),
            revision: None,
            reason: Some("Claude data directory was not found".to_string()),
            capabilities: claude_capabilities(),
        },
        Err(error) => SourceStatus {
            source_kind: SourceKind::Claude,
            state: SourceState::Unreadable,
            label: "~/.claude".to_string(),
            revision: None,
            reason: Some(format!("cannot inspect Claude data directory: {error}")),
            capabilities: claude_capabilities(),
        },
    }
}

fn claude_capabilities() -> SourceCapabilities {
    SourceCapabilities {
        sessions: true,
        transcripts: true,
        task_graph: claude_task_graph_capability(),
    }
}

fn claude_task_graph_capability() -> TaskGraphCapability {
    TaskGraphCapability {
        state: TaskGraphCapabilityState::Available,
        reason: "Claude Task Graph files are available".to_string(),
        diagnostics: Vec::<Diagnostic>::new(),
    }
}
