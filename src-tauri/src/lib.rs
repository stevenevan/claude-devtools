mod commands;
mod sidecar;
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
