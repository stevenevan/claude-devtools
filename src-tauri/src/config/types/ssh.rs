use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPersistConfig {
    pub last_connection: Option<SshLastConnection>,
    pub auto_reconnect: bool,
    pub profiles: Vec<SshConnectionProfile>,
    pub last_active_context_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshLastConnection {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
}

impl Default for SshPersistConfig {
    fn default() -> Self {
        Self {
            last_connection: None,
            auto_reconnect: false,
            profiles: vec![],
            last_active_context_id: "local".to_string(),
        }
    }
}
