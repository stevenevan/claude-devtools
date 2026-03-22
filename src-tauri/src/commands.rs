use std::sync::Mutex;

use crate::sidecar::SidecarState;
use crate::watcher;

/// Returns the port the sidecar HTTP server is listening on.
#[tauri::command]
pub fn get_sidecar_port(state: tauri::State<'_, Mutex<SidecarState>>) -> Result<u16, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    if state.port == 0 {
        return Err("Sidecar not started yet".to_string());
    }
    Ok(state.port)
}

/// Returns the app version from Cargo.toml.
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Start watching ~/.claude/projects/ and ~/.claude/todos/ for changes.
#[tauri::command]
pub fn start_watching(app: tauri::AppHandle) -> Result<(), String> {
    watcher::start_watcher(&app)
}

/// Stop file watching.
#[tauri::command]
pub fn stop_watching(app: tauri::AppHandle) -> Result<(), String> {
    watcher::stop_watcher(&app)
}
