pub mod analysis;
pub mod analytics;
pub mod cache;
pub mod commands;
pub mod config;
pub mod discovery;
pub mod notifications;
pub mod nl_query;
pub mod parsing;
pub mod plugins;
pub mod snapshots;
pub mod ssh;
pub mod timing;
pub mod types;
pub mod watcher;

use tauri_plugin_autostart::MacosLauncher;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_process::init())
        .manage(std::sync::Mutex::new(watcher::WatcherState::default()))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(cache::SessionCache::default())))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(discovery::subproject_registry::SubprojectRegistry::new())))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(config::manager::ConfigState::new())))
        .manage(std::sync::Mutex::new(notifications::manager::NotificationState::new()))
        .manage(std::sync::Arc::new(tokio::sync::Mutex::new(ssh::connection_manager::SshState::default())))
        .manage(std::sync::Arc::new(timing::TimingBuffer::default()))
        .setup(|app| {
            let handle = app.handle().clone();

            // Start file watcher immediately (fast — just registers OS watchers)
            if let Err(e) = watcher::start_watcher(&handle) {
                eprintln!("[tauri] WARNING: File watcher failed to start: {e}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_version,
            commands::start_watching,
            commands::stop_watching,
            commands::parse_session,
            commands::parse_session_metrics,
            commands::get_analytics,
            commands::get_cost_forecast,
            commands::get_productivity_metrics,
            commands::get_session_duration_stats,
            commands::get_model_comparison,
            analysis::commands::get_tool_analytics,
            analysis::commands::get_tool_time_heatmap,
            analysis::commands::get_error_hotspots,
            analysis::commands::get_error_clusters,
            analysis::commands::get_file_graph,
            commands::get_all_todos,
            commands::get_projects,
            commands::get_sessions_paginated,
            commands::get_session_detail,
            commands::get_session_detail_incremental,
            commands::get_sessions,
            commands::get_sessions_by_ids,
            commands::validate_path,
            commands::validate_mentions,
            commands::read_claude_md_files,
            commands::read_directory_claude_md,
            commands::read_mentioned_file,
            commands::read_agent_configs,
            commands::read_global_agents,
            commands::read_global_skills,
            commands::read_global_plugins,
            commands::read_global_settings,
            commands::search_sessions,
            commands::search_all_projects,
            commands::search_sessions_filtered,
            commands::search_session_content,
            commands::get_waterfall_data,
            commands::get_subagent_detail,
            commands::get_session_groups,
            commands::get_repository_groups,
            commands::get_worktree_sessions,
            commands::context_list,
            commands::context_get_active,
            commands::context_switch,
            commands::session_scroll_to_line,
            config::commands::config_get,
            config::commands::config_update,
            config::commands::config_add_ignore_regex,
            config::commands::config_remove_ignore_regex,
            config::commands::config_add_ignore_repository,
            config::commands::config_remove_ignore_repository,
            config::commands::config_snooze,
            config::commands::config_clear_snooze,
            config::commands::config_add_trigger,
            config::commands::config_update_trigger,
            config::commands::config_remove_trigger,
            config::commands::config_get_triggers,
            config::commands::config_pin_session,
            config::commands::config_unpin_session,
            config::commands::config_hide_session,
            config::commands::config_unhide_session,
            config::commands::config_hide_sessions,
            config::commands::config_unhide_sessions,
            config::commands::config_get_claude_root_info,
            config::commands::config_open_in_editor,
            config::commands::config_add_bookmark,
            config::commands::config_remove_bookmark,
            config::commands::config_get_bookmarks,
            config::commands::config_add_annotation,
            config::commands::config_update_annotation,
            config::commands::config_remove_annotation,
            config::commands::config_get_annotations,
            config::commands::config_set_session_tags,
            config::commands::config_get_session_tags,
            config::commands::config_create_group,
            config::commands::config_delete_group,
            config::commands::config_add_to_group,
            config::commands::config_remove_from_group,
            config::commands::config_get_groups,
            config::commands::config_add_filter_preset,
            config::commands::config_remove_filter_preset,
            config::commands::config_rename_filter_preset,
            config::commands::config_set_default_filter_preset,
            config::commands::config_export_annotations,
            config::commands::config_import_annotations,
            notifications::commands::notifications_get,
            notifications::commands::notifications_mark_read,
            notifications::commands::notifications_mark_all_read,
            notifications::commands::notifications_delete,
            notifications::commands::notifications_clear,
            notifications::commands::notifications_get_unread_count,
            notifications::commands::notifications_test_trigger,
            ssh::commands::ssh_get_config_hosts,
            ssh::commands::ssh_resolve_host,
            ssh::commands::ssh_connect,
            ssh::commands::ssh_disconnect,
            ssh::commands::ssh_get_state,
            ssh::commands::ssh_test,
            ssh::commands::ssh_save_last_connection,
            ssh::commands::ssh_get_last_connection,
            commands::link_tool_calls,
            commands::count_tokens,
            commands::count_tokens_batch,
            commands::window_bus_broadcast,
            commands::window_bus_ready,
            snapshots::snapshots_list,
            snapshots::snapshots_create_from_session,
            snapshots::snapshots_delete,
            snapshots::snapshots_open,
            plugins::plugins_discover,
            notifications::webhook::webhook_test_send,
            nl_query::parse_nl_query,
            timing::get_backend_timings,
            timing::get_cache_stats,
            timing::set_cache_capacity,
            timing::clear_session_cache,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = watcher::stop_watcher(app);
            }
        });
}
