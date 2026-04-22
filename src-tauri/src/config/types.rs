/// Config type definitions matching `~/.claude/claude-devtools-config.json`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// Top-Level Config

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
}

// Budget Config — spending thresholds (no alerting in sprint 18; see roadmap).

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetConfig {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub daily_budget_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub weekly_budget_usd: Option<f64>,
}

// Notification Config

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationConfig {
    pub enabled: bool,
    pub sound_enabled: bool,
    pub ignored_regex: Vec<String>,
    pub ignored_repositories: Vec<String>,
    pub snoozed_until: Option<f64>,
    pub snooze_minutes: u32,
    pub include_subagent_errors: bool,
    pub triggers: Vec<NotificationTrigger>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTrigger {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub content_type: String,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_builtin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_patterns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

// General Config

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralConfig {
    pub launch_at_login: bool,
    pub show_dock_icon: bool,
    pub theme: String,
    pub default_tab: String,
    pub claude_root_path: Option<String>,
    pub auto_expand_ai_groups: bool,
    pub use_native_title_bar: bool,
}

// Display Config

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    pub show_timestamps: bool,
    pub compact_mode: bool,
    pub syntax_highlighting: bool,
    #[serde(default = "default_code_block_theme")]
    pub code_block_theme: String,
    #[serde(default = "default_true")]
    pub show_line_numbers: bool,
    #[serde(default)]
    pub word_wrap: bool,
}

fn default_code_block_theme() -> String {
    "default".to_string()
}

fn default_true() -> bool {
    true
}

// Sessions Config

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsConfig {
    pub pinned_sessions: HashMap<String, Vec<PinnedSession>>,
    pub hidden_sessions: HashMap<String, Vec<HiddenSession>>,
    #[serde(default)]
    pub bookmarks: Vec<BookmarkEntry>,
    #[serde(default)]
    pub session_tags: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub annotations: Vec<AnnotationEntry>,
    #[serde(default)]
    pub session_groups: HashMap<String, Vec<String>>,
}

/// Inline annotation anchored to a specific display target (AI group, turn, item) in a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationEntry {
    pub id: String,
    pub session_id: String,
    pub project_id: String,
    pub target_id: String,
    pub text: String,
    pub color: String,
    pub created_at: f64,
    pub updated_at: f64,
}

/// A bookmark on a specific AI group within a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkEntry {
    pub id: String,
    pub session_id: String,
    pub project_id: String,
    pub group_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedSession {
    pub session_id: String,
    pub pinned_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenSession {
    pub session_id: String,
    pub hidden_at: f64,
}

// SSH Config

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

// HTTP Server Config

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

// Defaults

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
        }
    }
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            sound_enabled: true,
            ignored_regex: vec![
                r"The user doesn't want to proceed with this tool use\.".to_string(),
            ],
            ignored_repositories: vec![],
            snoozed_until: None,
            snooze_minutes: 30,
            include_subagent_errors: true,
            triggers: super::triggers::default_triggers(),
        }
    }
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            show_dock_icon: true,
            theme: "dark".to_string(),
            default_tab: "dashboard".to_string(),
            claude_root_path: None,
            auto_expand_ai_groups: false,
            use_native_title_bar: false,
        }
    }
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            show_timestamps: true,
            compact_mode: false,
            syntax_highlighting: true,
            code_block_theme: default_code_block_theme(),
            show_line_numbers: true,
            word_wrap: false,
        }
    }
}

impl Default for SessionsConfig {
    fn default() -> Self {
        Self {
            pinned_sessions: HashMap::new(),
            hidden_sessions: HashMap::new(),
            bookmarks: vec![],
            session_tags: HashMap::new(),
            annotations: vec![],
            session_groups: HashMap::new(),
        }
    }
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

impl Default for HttpServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 3456,
        }
    }
}

// Merge helpers

/// Merge a loaded partial JSON config with defaults, filling missing fields.
pub fn merge_config_with_defaults(loaded: &Value) -> AppConfig {
    let defaults = AppConfig::default();

    let obj = match loaded.as_object() {
        Some(o) => o,
        None => return defaults,
    };

    // Parse each section with fallback to defaults
    let notifications = match obj.get("notifications") {
        Some(v) => {
            let mut notif: NotificationConfig =
                serde_json::from_value(v.clone()).unwrap_or_default();
            // Merge triggers
            notif.triggers =
                super::triggers::merge_triggers(&notif.triggers, &defaults.notifications.triggers);
            notif
        }
        None => defaults.notifications.clone(),
    };

    let mut general: GeneralConfig = match obj.get("general") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.general.clone(),
    };
    general.claude_root_path = normalize_claude_root_path(general.claude_root_path.as_deref());

    let display: DisplayConfig = match obj.get("display") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.display.clone(),
    };

    let sessions: SessionsConfig = match obj.get("sessions") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.sessions.clone(),
    };

    let ssh: SshPersistConfig = match obj.get("ssh") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.ssh.clone(),
    };

    let http_server: HttpServerConfig = match obj.get("httpServer") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.http_server.clone(),
    };

    let budget: BudgetConfig = match obj.get("budget") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.budget.clone(),
    };

    AppConfig {
        notifications,
        general,
        display,
        sessions,
        ssh,
        http_server,
        budget,
    }
}

/// Normalize a claudeRootPath: must be absolute, trimmed, no trailing slashes.
pub fn normalize_claude_root_path(value: Option<&str>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let p = std::path::Path::new(trimmed);
    if !p.is_absolute() {
        return None;
    }

    // Canonicalize-lite: just normalize and strip trailing slashes
    let normalized = p.to_string_lossy().to_string();
    let root_len = if normalized.starts_with('/') { 1 } else { 3 }; // "/" or "C:\"
    let result = normalized.trim_end_matches(['/', '\\']);

    // Don't strip below root
    if result.len() < root_len {
        Some(normalized[..root_len].to_string())
    } else {
        Some(result.to_string())
    }
}
