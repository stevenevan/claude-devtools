use crate::watcher;

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn start_watching(app: tauri::AppHandle) -> Result<(), String> {
    watcher::start_watcher(&app)
}

#[tauri::command]
pub fn stop_watching(app: tauri::AppHandle) -> Result<(), String> {
    watcher::stop_watcher(&app)
}
