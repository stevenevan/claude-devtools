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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                sidecar::stop_sidecar(app);
            }
        });
}
