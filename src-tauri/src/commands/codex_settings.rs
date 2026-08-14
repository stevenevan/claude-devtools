//! Tauri boundary for Codex settings discovery.

use std::path::Path;
use std::sync::Arc;

use tauri::State;

use crate::files::codex_settings::{self, CodexSettingsContext, CodexSettingsView};
use crate::files::codex_settings_write::{
    self, CodexSettingsApplyResult, CodexSettingsPatch, CodexSettingsPreviewResult,
};
use crate::ssh::State as SshState;
use crate::system;

const ERR_SSH_ACTIVE: &str =
    "codex settings operate on the local machine only; disconnect the SSH session first";

#[tauri::command(rename_all = "camelCase")]
pub fn get_codex_settings(context: CodexSettingsContext) -> Result<CodexSettingsView, String> {
    codex_settings::discover(&context)
}

/// Opens the resolved local Codex directory. The path comes only from the
/// server-side CODEX_HOME resolver; the renderer cannot supply a target.
#[tauri::command(rename_all = "camelCase")]
pub fn open_codex_config_folder() -> Result<(), String> {
    let path = crate::config::root::codex_dir()?;
    let target = path.to_string_lossy();
    system::open_path_cmd(&target)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("codex settings: open config folder: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn preview_codex_settings_patch(
    context: CodexSettingsContext,
    patch: CodexSettingsPatch,
    expected_revision: String,
    ssh: State<'_, Arc<SshState>>,
) -> Result<CodexSettingsPreviewResult, String> {
    ensure_local(&ssh)?;
    let codex_home = crate::config::root::codex_dir()?;
    codex_settings_write::preview_at(
        &codex_home,
        &context,
        &patch,
        &expected_revision,
        system_root(),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn apply_codex_settings_patch(
    context: CodexSettingsContext,
    patch: CodexSettingsPatch,
    expected_revision: String,
    ssh: State<'_, Arc<SshState>>,
) -> Result<CodexSettingsApplyResult, String> {
    ensure_local(&ssh)?;
    let codex_home = crate::config::root::codex_dir()?;
    codex_settings_write::apply_at(
        &codex_home,
        &context,
        &patch,
        &expected_revision,
        system_root(),
    )
}

pub(crate) fn ensure_local(ssh: &SshState) -> Result<(), String> {
    if ssh.get_status().state != "disconnected" {
        return Err(ERR_SSH_ACTIVE.to_string());
    }
    Ok(())
}

fn system_root() -> Option<&'static Path> {
    #[cfg(unix)]
    {
        Some(Path::new("/etc/codex"))
    }
    #[cfg(not(unix))]
    {
        None
    }
}
