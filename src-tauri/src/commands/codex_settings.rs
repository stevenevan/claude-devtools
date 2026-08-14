//! Tauri boundary for Codex settings discovery.

use crate::files::codex_settings::{self, CodexSettingsContext, CodexSettingsView};
use crate::system;

#[tauri::command(rename_all = "camelCase")]
pub fn get_codex_settings(context: CodexSettingsContext) -> Result<CodexSettingsView, String> {
    codex_settings::discover(&context)
}

/// Opens the resolved local Codex directory. The path comes only from the
/// server-side CODEX_HOME resolver; the renderer cannot supply a target.
#[tauri::command(rename_all = "camelCase")]
pub fn open_codex_config_folder() -> Result<(), String> {
    let path = crate::config::root::codex_dir()?;
    system::open_path_cmd(&path.to_string_lossy())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("codex settings: open config folder: {error}"))
}
