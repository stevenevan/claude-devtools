// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use claude_devtools_lib::pipeline;
use claude_devtools_lib::types::chunks::SessionDetail;

// First real Tauri command (W7): the in-app session-detail load. Mirrors the
// frozen WailsAPI `getSessionDetail(projectId, sessionId) => SessionDetail | null`.
// rename_all = camelCase so JS passes { projectId, sessionId }.
#[tauri::command(rename_all = "camelCase")]
fn get_session_detail(project_id: String, session_id: String) -> Result<Option<SessionDetail>, String> {
    pipeline::get_session_detail(&project_id, &session_id).map(Some)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_session_detail])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
