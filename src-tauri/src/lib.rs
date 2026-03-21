mod commands;
mod sidecar;

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
        .setup(|app| {
            let handle = app.handle().clone();
            // Start sidecar — log errors but don't crash the app
            match sidecar::start_sidecar(&handle) {
                Ok(()) => {
                    // Inject port into the main webview
                    let state = handle.state::<std::sync::Mutex<sidecar::SidecarState>>();
                    let port = state.lock().unwrap().port;
                    if let Some(window) = app.get_webview_window("main") {
                        let js = format!("window.__SIDECAR_PORT__ = {port};");
                        let _ = window.eval(&js);
                    }
                }
                Err(e) => {
                    eprintln!("[tauri] WARNING: Sidecar failed to start: {e}");
                    eprintln!("[tauri] The app will open but backend services won't be available.");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_sidecar_port,
            commands::get_app_version,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                sidecar::stop_sidecar(app);
            }
        });
}
