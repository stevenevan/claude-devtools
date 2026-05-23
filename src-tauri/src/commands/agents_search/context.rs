use serde_json::Value;

#[tauri::command]
pub fn context_list() -> Result<Value, String> {
    Ok(serde_json::json!([{ "id": "local", "type": "local" }]))
}

#[tauri::command]
pub fn context_get_active() -> Result<String, String> {
    Ok("local".to_string())
}

#[tauri::command]
pub fn context_switch(context_id: String) -> Result<Value, String> {
    Ok(serde_json::json!({ "contextId": context_id }))
}

#[tauri::command]
pub fn session_scroll_to_line(
    session_id: String,
    line_number: u32,
) -> Result<Value, String> {
    Ok(serde_json::json!({
        "success": true,
        "sessionId": session_id,
        "lineNumber": line_number,
    }))
}
