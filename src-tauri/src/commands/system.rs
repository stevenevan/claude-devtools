use crate::watcher;
use serde_json::Value;

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

#[tauri::command]
pub fn log_renderer_event(level: String, msg: String, ctx: Option<Value>) {
    let ctx_json = ctx
        .as_ref()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{}".to_string());
    match level.as_str() {
        "error" => tracing::error!(target: "renderer", ctx = %ctx_json, "{msg}"),
        "warn" => tracing::warn!(target: "renderer", ctx = %ctx_json, "{msg}"),
        "debug" => tracing::debug!(target: "renderer", ctx = %ctx_json, "{msg}"),
        _ => tracing::info!(target: "renderer", ctx = %ctx_json, "{msg}"),
    }
}
