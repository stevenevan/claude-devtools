use serde::Deserialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastInput {
    pub origin_window_id: String,
    pub topic: String,
    pub seq: u64,
    pub payload: serde_json::Value,
}

const BROADCAST_EVENT: &str = "window-bus-message";

#[tauri::command]
pub fn window_bus_broadcast(
    app: AppHandle,
    message: BroadcastInput,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "originWindowId": message.origin_window_id,
        "topic": message.topic,
        "seq": message.seq,
        "payload": message.payload,
    });
    app.emit(BROADCAST_EVENT, payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_bus_ready(app: AppHandle, window_id: String) -> Result<(), String> {
    app.emit(
        "window-bus-ready",
        serde_json::json!({ "windowId": window_id }),
    )
    .map_err(|e| e.to_string())
}
