mod analysis;
mod cache;
mod commands;
mod config;
mod discovery;
mod notifications;
mod parsing;
mod sidecar;
mod types;
mod watcher;

use tauri::Manager;
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
        .manage(std::sync::Mutex::new(sidecar::SidecarState::default()))
        .manage(std::sync::Mutex::new(watcher::WatcherState::default()))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(cache::SessionCache::default())))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(discovery::subproject_registry::SubprojectRegistry::new())))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(config::manager::ConfigState::new())))
        .manage(std::sync::Mutex::new(notifications::manager::NotificationState::new()))
        .setup(|app| {
            let handle = app.handle().clone();

            // Start file watcher immediately (fast — just registers OS watchers)
            if let Err(e) = watcher::start_watcher(&handle) {
                eprintln!("[tauri] WARNING: File watcher failed to start: {e}");
            }

            // Start sidecar in a background thread so setup() returns immediately.
            // The webview polls get_sidecar_port via invoke(), which needs the main
            // thread — blocking here would deadlock those calls.
            std::thread::spawn(move || {
                match sidecar::start_sidecar(&handle) {
                    Ok(()) => {
                        let state = handle.state::<std::sync::Mutex<sidecar::SidecarState>>();
                        let port = state.lock().unwrap().port;
                        eprintln!("[tauri] Sidecar ready on port {port}");
                    }
                    Err(e) => {
                        eprintln!("[tauri] WARNING: Sidecar failed to start: {e}");
                        eprintln!("[tauri] The app will open but backend services won't be available.");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_sidecar_port,
            commands::get_app_version,
            commands::start_watching,
            commands::stop_watching,
            commands::parse_session,
            commands::parse_session_metrics,
            commands::get_projects,
            commands::get_sessions_paginated,
            commands::get_session_detail,
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
            notifications::commands::notifications_get,
            notifications::commands::notifications_mark_read,
            notifications::commands::notifications_mark_all_read,
            notifications::commands::notifications_delete,
            notifications::commands::notifications_clear,
            notifications::commands::notifications_get_unread_count,
            notifications::commands::notifications_test_trigger,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = watcher::stop_watcher(app);
                sidecar::stop_sidecar(app);
            }
        });
}
