//! SSH DTOs. Field shapes + json tags mirror the Go oracle `internal/ssh/types.go`
//! EXACTLY (serde camelCase; `skip_serializing_if = "Option::is_none"` ⇔ Go
//! `omitempty`; a plain `Option<T>` without skip serialises `None` as `null`,
//! mirroring a Go `*T` without omitempty).

use serde::{Deserialize, Serialize};

/// Mirrors Go `ConnectionConfig`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
}

/// Mirrors Go `ConnectionStatus`. state ∈ connecting|retrying|connected|error|disconnected.
/// host/error/remoteProjectsPath have no omitempty → serialise as `null` when `None`.
/// retryAttempt/maxRetries have omitempty → skipped when `None`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub state: String,
    pub host: Option<String>,
    pub error: Option<String>,
    pub remote_projects_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_attempt: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<u32>,
}

impl ConnectionStatus {
    /// Mirrors Go `Disconnected()` — the zero-state status.
    pub fn disconnected() -> Self {
        Self {
            state: "disconnected".to_string(),
            host: None,
            error: None,
            remote_projects_path: None,
            retry_attempt: None,
            max_retries: None,
        }
    }
}

/// Mirrors Go `ConfigHostEntry`. hostName/user/port have omitempty.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigHostEntry {
    pub alias: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub has_identity_file: bool,
}

/// Mirrors Go `LastConnection`. privateKeyPath has omitempty.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastConnection {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
}
