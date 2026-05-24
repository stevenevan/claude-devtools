use serde::{Deserialize, Serialize};

use super::dashboard::{BudgetConfig, DashboardConfig};
use super::general::{DisplayConfig, GeneralConfig};
use super::http::HttpServerConfig;
use super::notifications::NotificationConfig;
use super::sessions::SessionsConfig;
use super::ssh::SshPersistConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub notifications: NotificationConfig,
    pub general: GeneralConfig,
    pub display: DisplayConfig,
    pub sessions: SessionsConfig,
    pub ssh: SshPersistConfig,
    pub http_server: HttpServerConfig,
    #[serde(default)]
    pub budget: BudgetConfig,
    #[serde(default)]
    pub dashboard: DashboardConfig,
    #[serde(default)]
    pub shortcuts: ShortcutsConfig,
    #[serde(default)]
    pub themes: ThemesConfig,
    #[serde(default)]
    pub plugins: PluginsConfig,
    /// Notification rules engine (sprint 40).
    #[serde(default)]
    pub notification_rules: Vec<crate::notifications::types::NotificationRule>,
    /// Webhook endpoints (sprint 41).
    #[serde(default)]
    pub webhook_endpoints: Vec<crate::notifications::webhook::WebhookEndpoint>,
    /// Backend observability — tunable session-cache size (sprint 46).
    #[serde(default = "default_cache_max_sessions")]
    pub cache_max_sessions: usize,
    /// Whether onboarding tour has been completed/skipped (sprint 49).
    #[serde(default)]
    pub onboarding_completed: bool,
}

pub(super) fn default_cache_max_sessions() -> usize {
    50
}

// Plugins config — persisted enabled-plugin ids (sprint 39).

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsConfig {
    /// Plugin ids the user has explicitly enabled. Disabled or unknown
    /// plugins discovered on disk stay loaded as inert metadata.
    #[serde(default)]
    pub enabled: Vec<String>,
}

// Custom theme definitions (sprint 34).

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemesConfig {
    /// Active custom theme id. `None` means use built-in dark/light only.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub active_id: Option<String>,
    /// User-defined themes. Built-ins are not stored here.
    #[serde(default)]
    pub custom: Vec<CustomTheme>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    /// Which built-in theme overrides apply on top of: "dark" or "light".
    pub based_on: String,
    /// Map of CSS variable name (without leading `--`) → colour value.
    pub overrides: std::collections::HashMap<String, String>,
}

// Keyboard shortcut overrides (sprint 33).

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsConfig {
    /// Map of action id → override combo (e.g. "Cmd+K"). Missing entries fall
    /// back to defaults defined in the frontend registry.
    #[serde(default)]
    pub overrides: std::collections::HashMap<String, String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            notifications: NotificationConfig::default(),
            general: GeneralConfig::default(),
            display: DisplayConfig::default(),
            sessions: SessionsConfig::default(),
            ssh: SshPersistConfig::default(),
            http_server: HttpServerConfig::default(),
            budget: BudgetConfig::default(),
            dashboard: DashboardConfig::default(),
            shortcuts: ShortcutsConfig::default(),
            themes: ThemesConfig::default(),
            plugins: PluginsConfig::default(),
            notification_rules: Vec::new(),
            webhook_endpoints: Vec::new(),
            cache_max_sessions: default_cache_max_sessions(),
            onboarding_completed: false,
        }
    }
}
