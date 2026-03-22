/// Tauri commands for SSH operations.

use std::sync::Arc;

use tauri::Emitter;

use super::config_parser;
use super::connection_manager;
use super::types::{
    SshConfigHostEntry, SshConnectionConfig, SshConnectionStatus, SshLastConnection,
};

/// Type alias for managed SSH state.
pub type SshStateMutex = tokio::sync::Mutex<connection_manager::SshState>;

// =============================================================================
// SSH Config Commands (no connection needed)
// =============================================================================

#[tauri::command]
pub fn ssh_get_config_hosts() -> Result<Vec<SshConfigHostEntry>, String> {
    Ok(config_parser::get_config_hosts())
}

#[tauri::command]
pub fn ssh_resolve_host(alias: String) -> Result<Option<SshConfigHostEntry>, String> {
    Ok(config_parser::resolve_host(&alias))
}

// =============================================================================
// Connection Commands
// =============================================================================

#[tauri::command]
pub async fn ssh_connect(
    config: SshConnectionConfig,
    state: tauri::State<'_, Arc<SshStateMutex>>,
    app: tauri::AppHandle,
) -> Result<SshConnectionStatus, String> {
    // Disconnect existing connection first
    {
        let mut guard = state.lock().await;
        guard.connection = None;
    }

    // Emit connecting status
    let _ = app.emit(
        "ssh-status",
        SshConnectionStatus {
            state: "connecting".to_string(),
            host: Some(config.host.clone()),
            error: None,
            remote_projects_path: None,
        },
    );

    match connection_manager::connect(&config).await {
        Ok(conn) => {
            let status = SshConnectionStatus {
                state: "connected".to_string(),
                host: Some(config.host.clone()),
                error: None,
                remote_projects_path: Some(conn.remote_projects_path.clone()),
            };
            let _ = app.emit("ssh-status", &status);

            let mut guard = state.lock().await;
            guard.connection = Some(conn);

            Ok(status)
        }
        Err(e) => {
            let status = SshConnectionStatus {
                state: "error".to_string(),
                host: Some(config.host.clone()),
                error: Some(e.clone()),
                remote_projects_path: None,
            };
            let _ = app.emit("ssh-status", &status);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: tauri::State<'_, Arc<SshStateMutex>>,
    app: tauri::AppHandle,
) -> Result<SshConnectionStatus, String> {
    let mut guard = state.lock().await;
    guard.connection = None;

    let status = SshConnectionStatus::disconnected();
    let _ = app.emit("ssh-status", &status);

    Ok(status)
}

#[tauri::command]
pub async fn ssh_get_state(
    state: tauri::State<'_, Arc<SshStateMutex>>,
) -> Result<SshConnectionStatus, String> {
    let guard = state.lock().await;
    Ok(guard.get_status())
}

#[tauri::command]
pub async fn ssh_test(
    config: SshConnectionConfig,
) -> Result<serde_json::Value, String> {
    match connection_manager::test_connection(&config).await {
        Ok(()) => Ok(serde_json::json!({ "success": true })),
        Err(e) => Ok(serde_json::json!({ "success": false, "error": e })),
    }
}

// =============================================================================
// Last Connection Persistence (uses ConfigState)
// =============================================================================

#[tauri::command]
pub fn ssh_save_last_connection(
    config: SshLastConnection,
    config_state: tauri::State<'_, Arc<std::sync::Mutex<crate::config::manager::ConfigState>>>,
) -> Result<(), String> {
    let mut guard = config_state.lock().map_err(|e| e.to_string())?;
    guard.update_ssh_last_connection(Some(crate::config::types::SshLastConnection {
        host: config.host,
        port: config.port,
        username: config.username,
        auth_method: config.auth_method,
        private_key_path: config.private_key_path,
    }));
    Ok(())
}

#[tauri::command]
pub fn ssh_get_last_connection(
    config_state: tauri::State<'_, Arc<std::sync::Mutex<crate::config::manager::ConfigState>>>,
) -> Result<Option<SshLastConnection>, String> {
    let mut guard = config_state.lock().map_err(|e| e.to_string())?;
    let config = guard.get_config();
    Ok(config.ssh.last_connection.map(|lc| SshLastConnection {
        host: lc.host,
        port: lc.port,
        username: lc.username,
        auth_method: lc.auth_method,
        private_key_path: lc.private_key_path,
    }))
}
