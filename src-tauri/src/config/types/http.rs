use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpServerConfig {
    pub enabled: bool,
    pub port: u16,
}

// Claude Root Info (query response)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRootInfo {
    pub default_path: String,
    pub configured_path: Option<String>,
    pub effective_path: String,
}

impl Default for HttpServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 3456,
        }
    }
}
