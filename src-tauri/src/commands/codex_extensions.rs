//! Tauri commands for the read-only Codex plugin and MCP inventories.

use crate::commands::codex_inventory::resolve_inspection_context;
use crate::config::root;
use crate::files::{codex_mcp, codex_plugins};
use crate::system;
use crate::types::codex_inventory::CodexInspectionContext;
use crate::types::codex_mcp::CodexMcpStatusView;
use crate::types::codex_plugins::CodexPluginList;

#[tauri::command(rename_all = "camelCase")]
pub fn get_codex_plugins(context: CodexInspectionContext) -> Result<CodexPluginList, String> {
    let resolved = resolve_inspection_context(&context)?;
    codex_plugins::discover(
        &resolved.codex_home,
        &context.scope,
        resolved.project_context.as_ref(),
    )
    .map(|inventory| inventory.view)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_codex_mcp_status(context: CodexInspectionContext) -> Result<CodexMcpStatusView, String> {
    let resolved = resolve_inspection_context(&context)?;
    codex_mcp::discover(
        &resolved.codex_home,
        &context.scope,
        resolved.project_context.as_ref(),
    )
}

/// Opens the server-resolved local Codex plugins directory. The renderer
/// cannot supply or influence the target path.
#[tauri::command(rename_all = "camelCase")]
pub fn open_codex_plugins_folder() -> Result<(), String> {
    let codex_home = root::codex_dir()?;
    if !codex_home.is_absolute() {
        return Err("codex plugins: resolved CODEX_HOME must be absolute".to_string());
    }
    let target = codex_home.join("plugins");
    let target = target.to_string_lossy();
    system::open_path_cmd(&target)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("codex plugins: open plugins folder: {error}"))
}
