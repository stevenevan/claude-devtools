// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::State;

use claude_devtools_lib::analytics::{
    compute_analytics, compute_cost_forecast, compute_model_comparison,
    compute_productivity_metrics, compute_session_duration_stats, AnalyticsResponse, CostForecast,
    ModelComparisonResponse, ProductivityMetrics, SessionDurationResponse,
};
use claude_devtools_lib::cache::SessionCache;
use claude_devtools_lib::commands::notify::NotifyState;
use claude_devtools_lib::commands::{
    config as config_cmds, files as files_cmds, maintenance as maintenance_cmds,
    notify as notify_cmds, session as session_cmds,
};
use claude_devtools_lib::config::root;
use claude_devtools_lib::config::state::ConfigState;
use claude_devtools_lib::notifications::manager::NotificationState;
use claude_devtools_lib::insights::error_hotspots::{
    compute_error_clusters, compute_error_hotspots, ErrorClustersResponse, ErrorHotspotsResponse,
};
use claude_devtools_lib::insights::file_graph::{compute_file_graph, FileGraphResponse};
use claude_devtools_lib::insights::tool_analytics::{
    compute_tool_analytics, compute_tool_time_heatmap, ToolAnalyticsResponse,
    ToolTimeHeatmapResponse,
};
use claude_devtools_lib::pipeline;
use claude_devtools_lib::snapshots::{
    create_snapshot, delete_snapshot, list_snapshots, open_snapshot, SnapshotMeta,
};
use claude_devtools_lib::ssh::{
    connect_with_retry, default_retry_config, get_config_hosts, resolve_host, test_connection,
    ConfigHostEntry, ConnectionConfig, ConnectionStatus, LastConnection, NetDialer, State as SshState,
};
use claude_devtools_lib::system;
use claude_devtools_lib::timing::{summarize, CacheStats, PercentileSummary, TimingBuffer};
use claude_devtools_lib::types::chunks::SessionDetail;
use claude_devtools_lib::watcher::{resolve_claude_dir, Runner};
use tauri::Emitter;

// Shared managed state, mirroring the Go service layer: one SessionCache
// singleton (timingservice holds a ref) + one TimingBuffer.
type SharedCache = Arc<Mutex<SessionCache>>;
type SharedTiming = Arc<TimingBuffer>;
// The live file watcher (W10). None until start_watching. Mirrors systemservice's
// `runner *watcher.Runner` guarded field.
type SharedWatcher = Arc<Mutex<Option<Runner>>>;
// SSH connection state (W11) + last-connection. Go persists last-connection to
// the config file (ConfigState); that disk layer is the W12 config-files spine,
// so W11 holds it in-memory (same API + within-session behavior).
type SharedSsh = Arc<SshState>;
type SharedLastConn = Arc<Mutex<Option<LastConnection>>>;
// Config store (W12): the persisted ~/.claude/claude-devtools-config.json,
// lazily loaded. Mirrors Go's ConfigService-owned ConfigState singleton.
type SharedConfig = Arc<ConfigState>;
// Maintenance service state (W13): owns the ssh-gate + watcher-mute + scan/policy
// concurrency + the in-app scheduler. Mirrors Go's MaintenanceService singleton.
type SharedMaintenance = Arc<maintenance_cmds::MaintenanceState>;

// Builds a ConnectionStatus emission (connecting/retrying/connected/error).
fn ssh_status(
    state: &str,
    host: Option<String>,
    error: Option<String>,
    remote_projects_path: Option<String>,
    retry_attempt: Option<u32>,
    max_retries: Option<u32>,
) -> ConnectionStatus {
    ConnectionStatus {
        state: state.to_string(),
        host,
        error,
        remote_projects_path,
        retry_attempt,
        max_retries,
    }
}

// First real Tauri command (W7): the in-app session-detail load. Mirrors the
// frozen DesktopAPI `getSessionDetail(projectId, sessionId) => SessionDetail | null`.
#[tauri::command(rename_all = "camelCase")]
fn get_session_detail(project_id: String, session_id: String) -> Result<Option<SessionDetail>, String> {
    pipeline::get_session_detail(&project_id, &session_id).map(Some)
}

// ── W8 analytics commands (stateless — analyticsservice.Get* → Compute*) ──────

#[tauri::command(rename_all = "camelCase")]
fn get_analytics(days: u32) -> Result<AnalyticsResponse, String> {
    compute_analytics(days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_cost_forecast(window_days: u32) -> Result<CostForecast, String> {
    compute_cost_forecast(window_days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_productivity_metrics(days: u32) -> Result<ProductivityMetrics, String> {
    compute_productivity_metrics(days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_session_duration_stats(days: u32) -> Result<SessionDurationResponse, String> {
    compute_session_duration_stats(days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_model_comparison(days: u32) -> Result<ModelComparisonResponse, String> {
    compute_model_comparison(days)
}

// ── W8 timing / cache commands (timingservice) ───────────────────────────────

#[tauri::command(rename_all = "camelCase")]
fn get_backend_timings(
    limit: Option<usize>,
    timing: State<'_, SharedTiming>,
) -> Result<Vec<PercentileSummary>, String> {
    let entries = timing.snapshot(limit);
    Ok(summarize(&entries))
}

#[tauri::command(rename_all = "camelCase")]
fn get_cache_stats(cache: State<'_, SharedCache>) -> Result<CacheStats, String> {
    let guard = cache.lock().map_err(|e| e.to_string())?;
    let total = guard.hits + guard.misses;
    let hit_rate = if total == 0 {
        0.0
    } else {
        guard.hits as f64 / total as f64
    };
    Ok(CacheStats {
        capacity: guard.capacity(),
        size: guard.len(),
        hits: guard.hits,
        misses: guard.misses,
        evicts: guard.evicts,
        hit_rate,
    })
}

#[tauri::command(rename_all = "camelCase")]
fn set_cache_capacity(capacity: usize, cache: State<'_, SharedCache>) -> Result<(), String> {
    cache.lock().map_err(|e| e.to_string())?.set_capacity(capacity);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn clear_session_cache(cache: State<'_, SharedCache>) -> Result<(), String> {
    cache.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

// ── W9 insights commands ─────────────────────────────────────────────────────

// SECURITY: the insights compute functions build the corpus path from the
// frontend-supplied project_id by raw join (resolve_project_dir), so guard it
// here at the command boundary. Go's analyticsservice does NOT (it passes args
// straight through) — this hardens the Tauri path without breaking parity, since
// legit dashed / `::`-composite ids pass. Rejects traversal / control chars.
fn validate_project_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 200 {
        return Err("invalid project_id".into());
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") || id.contains('\0') {
        return Err("project_id contains an illegal path component".into());
    }
    if id.chars().any(|c| c.is_control()) {
        return Err("project_id contains a control character".into());
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn get_tool_analytics(project_id: String, days: u32) -> Result<ToolAnalyticsResponse, String> {
    validate_project_id(&project_id)?;
    compute_tool_analytics(&project_id, days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_tool_time_heatmap(
    project_id: String,
    days: u32,
    tool_filter: Option<String>,
) -> Result<ToolTimeHeatmapResponse, String> {
    validate_project_id(&project_id)?;
    compute_tool_time_heatmap(&project_id, days, tool_filter.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
fn get_error_hotspots(
    project_id: String,
    days: u32,
    min_occurrences: u32,
) -> Result<ErrorHotspotsResponse, String> {
    validate_project_id(&project_id)?;
    compute_error_hotspots(&project_id, days, min_occurrences)
}

#[tauri::command(rename_all = "camelCase")]
fn get_error_clusters(
    project_id: String,
    days: u32,
    min_cluster_size: u32,
) -> Result<ErrorClustersResponse, String> {
    validate_project_id(&project_id)?;
    compute_error_clusters(&project_id, days, min_cluster_size)
}

#[tauri::command(rename_all = "camelCase")]
fn get_file_graph(project_id: String, session_id: String) -> Result<FileGraphResponse, String> {
    validate_project_id(&project_id)?;
    // Root resolved from ~/.claude/projects, matching analyticsservice.GetFileGraph
    // when canonicalRoot is empty.
    let root_dir = root::projects_dir()?;
    compute_file_graph(&root_dir, &project_id, &session_id)
}

// ── W9 snapshots commands ────────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
fn snapshots_list() -> Result<Vec<SnapshotMeta>, String> {
    list_snapshots()
}

#[tauri::command(rename_all = "camelCase")]
fn snapshots_create_from_session(
    project_id: String,
    session_id: String,
    label: Option<String>,
) -> Result<SnapshotMeta, String> {
    let detail = pipeline::get_session_detail(&project_id, &session_id)?;
    // Label fallback = session id when blank/whitespace (snapshotservice.go:29-32).
    let resolved = match label {
        Some(l) if !l.trim().is_empty() => l,
        _ => detail.session.id.clone(),
    };
    create_snapshot(&resolved, &detail)
}

#[tauri::command(rename_all = "camelCase")]
fn snapshots_delete(snapshot_id: String) -> Result<(), String> {
    delete_snapshot(&snapshot_id)
}

#[tauri::command(rename_all = "camelCase")]
fn snapshots_open(snapshot_id: String) -> Result<SessionDetail, String> {
    open_snapshot(&snapshot_id)
}

// ── W10 file watcher bridge ──────────────────────────────────────────────────
// The Tauri twin of systemservice.StartWatching/StopWatching. emit_fn = app.emit,
// so watcher `file-change`/`todo-change`/`config-file-change` events reach the
// frontend's W02 listeners identically to the legacy path. NOTE (verified): no
// tracked source on EITHER backend triggers StartWatching today — the frontend
// listens but nothing starts the watcher (systemservice.go:71 "command-triggered,
// not auto-started"; grep finds no caller). These commands complete the emit path
// for when a trigger is added; they are not invoked by the frozen DesktopAPI.

#[tauri::command(rename_all = "camelCase")]
fn start_watching(app: tauri::AppHandle, watcher: State<'_, SharedWatcher>) -> Result<(), String> {
    let mut guard = watcher.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(()); // already watching (idempotent, mirrors Go)
    }
    let claude_dir = resolve_claude_dir().ok_or("cannot resolve home directory")?;
    let projects_dir = claude_dir.join("projects");
    let todos_dir = claude_dir.join("todos");
    // config_dir = claude_dir so settings.json writes surface; claude_json_dir =
    // home so ~/.claude.json writes do too (matches systemservice.StartWatching).
    let claude_json_dir = dirs::home_dir().unwrap_or_default();

    let emit_app = app.clone();
    let runner = Runner::new(
        &projects_dir.to_string_lossy(),
        &todos_dir.to_string_lossy(),
        &claude_dir.to_string_lossy(),
        &claude_json_dir.to_string_lossy(),
        move |event: &str, payload: serde_json::Value| {
            let _ = emit_app.emit(event, payload);
        },
    );
    runner.start()?;
    *guard = Some(runner);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn stop_watching(watcher: State<'_, SharedWatcher>) -> Result<(), String> {
    let mut guard = watcher.lock().map_err(|e| e.to_string())?;
    if let Some(runner) = guard.take() {
        runner.stop();
    }
    Ok(())
}

// ── W11 SSH commands (mirror sshservice's 8) ─────────────────────────────────
// connect/test are async (russh). connect emits ssh-status (connecting →
// retrying* → connected/error) via app.emit, reaching the frontend's W02
// onStatus listener identically to the legacy path.

#[tauri::command(rename_all = "camelCase")]
async fn ssh_connect(
    config: ConnectionConfig,
    app: tauri::AppHandle,
    ssh: State<'_, SharedSsh>,
) -> Result<ConnectionStatus, String> {
    let state = ssh.inner().clone();
    state.clear_conn(); // drop any live connection before dialing (Go H4)
    let host = config.host.clone();
    let _ = app.emit(
        "ssh-status",
        ssh_status("connecting", Some(host.clone()), None, None, None, None),
    );

    let retry = default_retry_config();
    let emit_app = app.clone();
    let emit_host = host.clone();
    let result = connect_with_retry(&config, &retry, &NetDialer, move |attempt, max, err| {
        let _ = emit_app.emit(
            "ssh-status",
            ssh_status(
                "retrying",
                Some(emit_host.clone()),
                Some(err.to_string()),
                None,
                Some(attempt),
                Some(max),
            ),
        );
    })
    .await;

    match result {
        Ok(conn) => {
            let status = ssh_status(
                "connected",
                Some(host),
                None,
                Some(conn.remote_projects_path.clone()),
                None,
                None,
            );
            let _ = app.emit("ssh-status", status.clone());
            state.set_conn(Some(conn)); // swap AFTER emitting (no lock across I/O)
            Ok(status)
        }
        Err(e) => {
            let status = ssh_status("error", Some(host), Some(e.clone()), None, None, None);
            let _ = app.emit("ssh-status", status);
            Err(e)
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
fn ssh_disconnect(app: tauri::AppHandle, ssh: State<'_, SharedSsh>) -> Result<ConnectionStatus, String> {
    ssh.clear_conn();
    let status = ConnectionStatus::disconnected();
    let _ = app.emit("ssh-status", status.clone());
    Ok(status)
}

#[tauri::command(rename_all = "camelCase")]
fn ssh_get_state(ssh: State<'_, SharedSsh>) -> Result<ConnectionStatus, String> {
    Ok(ssh.get_status())
}

#[tauri::command(rename_all = "camelCase")]
async fn ssh_test(config: ConnectionConfig) -> Result<serde_json::Value, String> {
    match test_connection(&config, &NetDialer).await {
        Ok(()) => Ok(serde_json::json!({ "success": true })),
        Err(e) => Ok(serde_json::json!({ "success": false, "error": e })),
    }
}

#[tauri::command(rename_all = "camelCase")]
fn ssh_get_config_hosts() -> Result<Vec<ConfigHostEntry>, String> {
    Ok(get_config_hosts())
}

#[tauri::command(rename_all = "camelCase")]
fn ssh_resolve_host(alias: String) -> Result<Option<ConfigHostEntry>, String> {
    Ok(resolve_host(&alias))
}

#[tauri::command(rename_all = "camelCase")]
fn ssh_save_last_connection(
    config: LastConnection,
    last: State<'_, SharedLastConn>,
) -> Result<(), String> {
    *last.lock().map_err(|e| e.to_string())? = Some(config);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn ssh_get_last_connection(last: State<'_, SharedLastConn>) -> Result<Option<LastConnection>, String> {
    Ok(last.lock().map_err(|e| e.to_string())?.clone())
}

// ── W11 system commands (systemservice) ──────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
fn get_app_version() -> Result<String, String> {
    Ok(system::app_version().to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn log_renderer_event(
    level: String,
    message: String,
    context: serde_json::Value,
) -> Result<(), String> {
    system::log_renderer_event(&level, &message, &context)
}

#[tauri::command]
fn plugins_discover() -> Result<Vec<system::PluginEntry>, String> {
    system::plugins_discover()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command(rename_all = "camelCase")]
fn open_path(target_path: String, _project_root: Option<String>) -> serde_json::Value {
    // Go's OpenPath ignores projectRoot. argv form (system::open_path_cmd) — never shell.
    match system::open_path_cmd(&target_path).spawn() {
        Ok(_) => serde_json::json!({ "success": true }),
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command(rename_all = "camelCase")]
fn get_all_todos(project_ids: Vec<String>) -> Result<Vec<system::AggregatedSessionTodos>, String> {
    system::get_all_todos(project_ids)
}

fn main() {
    // Go defaults (cache.go:27-28): capacity 50, ttl 600s.
    let cache: SharedCache = Arc::new(Mutex::new(SessionCache::new(50, Duration::from_secs(600))));
    let timing: SharedTiming = Arc::new(TimingBuffer::default());
    let watcher: SharedWatcher = Arc::new(Mutex::new(None));
    let ssh: SharedSsh = Arc::new(SshState::new());
    let last_conn: SharedLastConn = Arc::new(Mutex::new(None));
    let config: SharedConfig = Arc::new(ConfigState::new());
    // W14: the persisted notification store. Constructed BEFORE MaintenanceState
    // so the pending-cleanup closure can capture its Arc — the two share nothing
    // else. (Store path: $HOME/.claude/claude-devtools-notifications.json.)
    let notification_state: Arc<NotificationState> = Arc::new(NotificationState::new());
    // W14 replaces the W13 NO-OP raise_pending seam: the scheduler's pending
    // cleanup report routes through the real NotificationService raise. The
    // closure adds the dedup'd alert to the store (no live emit — it is built
    // before the AppHandle exists; the alert surfaces on the next fetch).
    let raise_notif = notification_state.clone();
    // W13: shares the config/cache/ssh Arcs with the other services (clone before
    // .manage moves them).
    let maintenance: SharedMaintenance = Arc::new(maintenance_cmds::MaintenanceState::new(
        config.clone(),
        cache.clone(),
        ssh.clone(),
        Box::new(move |categories: &[String], total_bytes: i64| {
            notify_cmds::raise_pending_cleanup(&raise_notif, categories, total_bytes);
            Ok(())
        }),
    ));
    // W14: the notification command state shares the store Arc (with the seam)
    // and the config Arc (for the policy setter).
    let notify_state = NotifyState {
        state: notification_state,
        config: config.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        // W14: native save/open dialogs (config export/import) + desktop toasts.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(cache)
        .manage(timing)
        .manage(watcher)
        .manage(ssh)
        .manage(last_conn)
        .manage(config)
        .manage(maintenance)
        .manage(notify_state)
        .setup(|app| {
            // Sync OS autostart to the persisted setting on launch (Go ServiceStartup).
            use tauri::Manager;
            let cfg = app.state::<SharedConfig>();
            let enable = cfg.get_config().general.launch_at_login;
            config_cmds::sync_autostart(app.handle(), enable);
            // W14: apply the persisted notification auto-prune policy over the
            // store's constructor defaults (Go NotificationService.ServiceStartup).
            let nc = cfg.get_config().notifications;
            app.state::<NotifyState>()
                .state
                .set_policy(nc.retention_days, nc.max_count);
            // W13: launch the maintenance scheduler thread (Go ServiceStartup →
            // startScheduler). Catch-up runs async on its first wake.
            let maint = app.state::<SharedMaintenance>().inner().clone();
            maintenance_cmds::spawn_scheduler(app.handle().clone(), maint);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_session_detail,
            session_cmds::get_projects,
            session_cmds::get_sessions,
            session_cmds::get_sessions_paginated,
            session_cmds::get_sessions_by_ids,
            session_cmds::get_session_detail_incremental,
            session_cmds::get_session_metrics,
            session_cmds::get_waterfall_data,
            session_cmds::get_subagent_detail,
            session_cmds::get_session_groups,
            session_cmds::get_repository_groups,
            session_cmds::get_worktree_sessions,
            session_cmds::search_sessions,
            session_cmds::search_all_projects,
            session_cmds::search_sessions_filtered,
            session_cmds::search_session_content,
            session_cmds::session_scroll_to_line,
            claude_devtools_lib::nl_query::parse_nl_query,
            get_analytics,
            get_cost_forecast,
            get_productivity_metrics,
            get_session_duration_stats,
            get_model_comparison,
            get_backend_timings,
            get_cache_stats,
            set_cache_capacity,
            clear_session_cache,
            get_tool_analytics,
            get_tool_time_heatmap,
            get_error_hotspots,
            get_error_clusters,
            get_file_graph,
            snapshots_list,
            snapshots_create_from_session,
            snapshots_delete,
            snapshots_open,
            start_watching,
            stop_watching,
            ssh_connect,
            ssh_disconnect,
            ssh_get_state,
            ssh_test,
            ssh_get_config_hosts,
            ssh_resolve_host,
            ssh_save_last_connection,
            ssh_get_last_connection,
            get_app_version,
            log_renderer_event,
            open_path,
            get_all_todos,
            plugins_discover,
            quit_app,
            // ── W12 config commands ──
            config_cmds::config_get,
            config_cmds::config_update,
            config_cmds::config_add_ignore_regex,
            config_cmds::config_remove_ignore_regex,
            config_cmds::config_add_ignore_repository,
            config_cmds::config_remove_ignore_repository,
            config_cmds::config_snooze,
            config_cmds::config_clear_snooze,
            config_cmds::config_add_trigger,
            config_cmds::config_update_trigger,
            config_cmds::config_remove_trigger,
            config_cmds::config_get_triggers,
            config_cmds::config_pin_session,
            config_cmds::config_unpin_session,
            config_cmds::config_hide_session,
            config_cmds::config_unhide_session,
            config_cmds::config_hide_sessions,
            config_cmds::config_unhide_sessions,
            config_cmds::config_get_claude_root_info,
            config_cmds::config_open_in_editor,
            config_cmds::config_add_bookmark,
            config_cmds::config_remove_bookmark,
            config_cmds::config_get_bookmarks,
            config_cmds::config_add_annotation,
            config_cmds::config_update_annotation,
            config_cmds::config_remove_annotation,
            config_cmds::config_get_annotations,
            config_cmds::config_set_session_tags,
            config_cmds::config_get_session_tags,
            config_cmds::config_create_group,
            config_cmds::config_delete_group,
            config_cmds::config_add_to_group,
            config_cmds::config_remove_from_group,
            config_cmds::config_get_groups,
            config_cmds::config_add_filter_preset,
            config_cmds::config_remove_filter_preset,
            config_cmds::config_rename_filter_preset,
            config_cmds::config_set_default_filter_preset,
            config_cmds::config_export_annotations,
            config_cmds::config_import_annotations,
            config_cmds::get_dismissed_suggestions,
            config_cmds::dismiss_suggestion,
            // ── W12 files commands ──
            files_cmds::validate_path,
            files_cmds::validate_mentions,
            files_cmds::read_claude_md_files,
            files_cmds::read_directory_claude_md,
            files_cmds::read_mentioned_file,
            files_cmds::read_agent_configs,
            files_cmds::read_global_plugins,
            files_cmds::read_global_settings,
            files_cmds::update_global_settings,
            files_cmds::read_hooks,
            files_cmds::toggle_hook,
            files_cmds::set_plugin_enabled,
            files_cmds::dedupe_plugin,
            files_cmds::detect_plugin_duplicates,
            files_cmds::enumerate_settings_sources,
            files_cmds::read_claude_json,
            files_cmds::reveal_claude_json_value,
            files_cmds::read_claude_json_masked,
            files_cmds::list_claude_json_backups,
            files_cmds::read_claude_json_backup,
            files_cmds::get_mcp_status,
            files_cmds::get_permission_rules,
            files_cmds::add_permission_rule,
            files_cmds::remove_permission_rule,
            files_cmds::move_permission_rule,
            files_cmds::analyze_permission_suggestions,
            files_cmds::purge_claude_json_projects,
            files_cmds::list_claude_json_app_backups,
            files_cmds::restore_claude_json_app_backup,
            files_cmds::add_mcp_server,
            files_cmds::update_mcp_server,
            files_cmds::remove_mcp_server,
            // ── read-only viewers ──
            files_cmds::list_shell_snapshots,
            files_cmds::read_shell_snapshot,
            files_cmds::read_usage_stats,
            files_cmds::list_telemetry_events,
            files_cmds::read_telemetry_event,
            files_cmds::list_file_history,
            files_cmds::read_checkpoint,
            files_cmds::export_checkpoint,
            files_cmds::read_status_line,
            files_cmds::update_status_line,
            files_cmds::read_history_page,
            files_cmds::list_transcripts,
            files_cmds::read_transcript,
            files_cmds::read_marketplace_catalog,
            files_cmds::list_task_graphs,
            files_cmds::read_task_graph,
            // ── W13 maintenance: service.go ──
            maintenance_cmds::scan_claude_dir,
            maintenance_cmds::scan_category,
            maintenance_cmds::get_maintenance_cutoff,
            maintenance_cmds::set_maintenance_cutoff,
            maintenance_cmds::read_plan_file,
            maintenance_cmds::rollback_binary,
            maintenance_cmds::analyze_history,
            maintenance_cmds::prune_history,
            maintenance_cmds::clear_files,
            maintenance_cmds::get_maintenance_health,
            maintenance_cmds::list_settings_generations,
            maintenance_cmds::read_settings_generation,
            maintenance_cmds::restore_settings_generation,
            maintenance_cmds::cancel_scan,
            maintenance_cmds::trash_items,
            maintenance_cmds::list_trash,
            maintenance_cmds::restore_trash,
            maintenance_cmds::empty_trash,
            // ── W13 maintenance: cleanup.go ──
            maintenance_cmds::preview_policy_clean,
            maintenance_cmds::run_policy_clean,
            maintenance_cmds::cancel_policy_clean,
            // ── W13 maintenance: scheduler.go ──
            maintenance_cmds::get_schedule_status,
            // ── W13 maintenance: agents.go ──
            maintenance_cmds::list_managed_agents,
            maintenance_cmds::patch_agent_frontmatter,
            maintenance_cmds::create_agent,
            maintenance_cmds::delete_agent,
            // ── W13 maintenance: instructions.go ──
            maintenance_cmds::list_instruction_files,
            maintenance_cmds::read_instruction_file,
            maintenance_cmds::write_instruction_file,
            maintenance_cmds::delete_instruction_file,
            // ── W13 maintenance: memory.go ──
            maintenance_cmds::list_memory_dirs,
            maintenance_cmds::memory_integrity,
            maintenance_cmds::read_memory_file,
            maintenance_cmds::write_memory_file,
            maintenance_cmds::apply_memory_index_fix,
            maintenance_cmds::delete_memory_file,
            // ── W13 maintenance: skills.go ──
            maintenance_cmds::skills_inventory,
            maintenance_cmds::read_skill_doc,
            maintenance_cmds::write_skill_doc,
            maintenance_cmds::remove_skill_link,
            maintenance_cmds::delete_skill,
            // ── W14 maintenance: configbackup.go ──
            maintenance_cmds::capture_config,
            maintenance_cmds::list_config_backups,
            maintenance_cmds::restore_config,
            maintenance_cmds::delete_config_backup,
            maintenance_cmds::export_backup,
            maintenance_cmds::validate_import_dialog,
            maintenance_cmds::apply_import,
            // ── W14 notify: notifyservice.go ──
            notify_cmds::get_state,
            notify_cmds::notifications_get,
            notify_cmds::notifications_mark_read,
            notify_cmds::notifications_mark_all_read,
            notify_cmds::notifications_delete,
            notify_cmds::notifications_clear,
            notify_cmds::notifications_get_unread_count,
            notify_cmds::notifications_test_trigger,
            notify_cmds::webhook_test_send,
            notify_cmds::set_notification_policy,
            notify_cmds::detect_and_notify,
            notify_cmds::raise_config_drift,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
