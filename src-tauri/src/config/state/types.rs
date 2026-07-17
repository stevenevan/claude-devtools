//! Config DTOs. Field shapes + json tags mirror the Go oracle
//! `internal/config/types.go` EXACTLY (serde camelCase; `skip_serializing_if =
//! "Option::is_none"` ⇔ Go `omitempty`; a plain `Option<T>` without skip
//! serialises `None` as `null`, mirroring a Go `*T` without omitempty; `Vec<T>`
//! ⇔ Go `[]T` initialised to `[]T{}` never nil; `BTreeMap` mirrors Go's
//! sorted-key map marshal).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── General ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralConfig {
    pub launch_at_login: bool,
    pub theme: String,
    pub default_tab: String,
    pub claude_root_path: Option<String>,
    pub auto_expand_ai_groups: bool,
    pub use_native_title_bar: bool,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            theme: "dark".to_string(),
            default_tab: "dashboard".to_string(),
            claude_root_path: None,
            auto_expand_ai_groups: false,
            use_native_title_bar: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    pub code_block_theme: String,
    pub show_line_numbers: bool,
    pub word_wrap: bool,
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            code_block_theme: "default".to_string(),
            show_line_numbers: true,
            word_wrap: false,
        }
    }
}

// ── Notifications ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// `snoozed_until` has no skip_serializing_if → `Option<f64>` serialised as
/// `null` when `None` (matches Go `*float64` without omitempty).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    pub retention_days: i64,
    pub max_count: i64,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            sound_enabled: true,
            ignored_regex: vec![r"The user doesn't want to proceed with this tool use\.".to_string()],
            ignored_repositories: vec![],
            snoozed_until: None,
            snooze_minutes: 30,
            include_subagent_errors: true,
            triggers: super::triggers::default_triggers(),
            retention_days: 30,
            max_count: 200,
        }
    }
}

// ── Sessions ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedSession {
    pub session_id: String,
    pub pinned_at: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenSession {
    pub session_id: String,
    pub hidden_at: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// `filter` is stored as raw JSON (serde_json::Value ⇔ Go json.RawMessage).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterPreset {
    pub id: String,
    pub name: String,
    pub filter: Value,
    pub created_at: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationExportBundle {
    pub version: u32,
    pub exported_at: f64,
    pub annotations: Vec<AnnotationEntry>,
    pub bookmarks: Vec<BookmarkEntry>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub annotations_added: u32,
    pub annotations_updated: u32,
    pub annotations_skipped: u32,
    pub bookmarks_added: u32,
    pub bookmarks_skipped: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsConfig {
    pub pinned_sessions: BTreeMap<String, Vec<PinnedSession>>,
    pub hidden_sessions: BTreeMap<String, Vec<HiddenSession>>,
    pub bookmarks: Vec<BookmarkEntry>,
    pub session_tags: BTreeMap<String, Vec<String>>,
    pub annotations: Vec<AnnotationEntry>,
    pub session_groups: BTreeMap<String, Vec<String>>,
    pub filter_presets: Vec<FilterPreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_filter_preset_id: Option<String>,
}

impl Default for SessionsConfig {
    fn default() -> Self {
        Self {
            pinned_sessions: BTreeMap::new(),
            hidden_sessions: BTreeMap::new(),
            bookmarks: vec![],
            session_tags: BTreeMap::new(),
            annotations: vec![],
            session_groups: BTreeMap::new(),
            filter_presets: vec![],
            default_filter_preset_id: None,
        }
    }
}

// ── SSH ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshLastConnection {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// `last_connection` has no skip → serialises `null` when `None`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPersistConfig {
    pub last_connection: Option<SshLastConnection>,
    pub auto_reconnect: bool,
    pub profiles: Vec<SshConnectionProfile>,
    pub last_active_context_id: String,
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

// ── HTTP ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpServerConfig {
    pub enabled: bool,
    pub port: u16,
}

impl Default for HttpServerConfig {
    fn default() -> Self {
        Self { enabled: false, port: 3456 }
    }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardConfig {
    pub widget_order: Vec<String>,
    pub hidden_widgets: Vec<String>,
}

// ── App (themes, shortcuts, plugins) ─────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    pub based_on: String,
    pub overrides: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemesConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_id: Option<String>,
    pub custom: Vec<CustomTheme>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsConfig {
    pub overrides: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsConfig {
    pub enabled: Vec<String>,
}

// ── Notification rules + webhooks (opaque payloads) ──────────────────────────

/// Stored opaquely — persisted faithfully as raw JSON (Go `json.RawMessage`).
pub type NotificationRule = Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEndpoint {
    pub id: String,
    pub label: String,
    pub url: String,
    pub template: String,
}

// ── Retention (W31) ───────────────────────────────────────────────────────────

/// The 15 trash-governed matcher ids + "history"; the 3 plain-delete ids
/// {logs, logs-daemon, caches} are intentionally excluded (Architect HIGH-1).
pub const TRASH_GOVERNED_POLICY_IDS: [&str; 16] = [
    "backup-binaries", "file-history", "junk-dsstore", "junk-tmp",
    "junk-emptydirs", "plans", "plugins", "projects", "runtime-tasks",
    "runtime-tasks-empty", "runtime-jobs", "runtime-sessions",
    "runtime-session-env", "runtime-shell-snapshots", "transcripts",
    "history",
];

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionCategory {
    pub enabled: bool,
    pub auto_approved: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicy {
    pub categories: BTreeMap<String, RetentionCategory>,
    pub trash_expiry_days: i64,
    pub schedule_interval: String,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        let mut categories = BTreeMap::new();
        for id in TRASH_GOVERNED_POLICY_IDS {
            categories.insert(
                id.to_string(),
                RetentionCategory { enabled: true, auto_approved: false },
            );
        }
        Self { categories, trash_expiry_days: 30, schedule_interval: "off".to_string() }
    }
}

// ── AppConfig (top-level) ─────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub notifications: NotificationConfig,
    pub general: GeneralConfig,
    pub display: DisplayConfig,
    pub sessions: SessionsConfig,
    pub ssh: SshPersistConfig,
    pub http_server: HttpServerConfig,
    pub dashboard: DashboardConfig,
    pub shortcuts: ShortcutsConfig,
    pub themes: ThemesConfig,
    pub plugins: PluginsConfig,
    pub notification_rules: Vec<NotificationRule>,
    pub webhook_endpoints: Vec<WebhookEndpoint>,
    pub onboarding_completed: bool,
    pub maintenance_cutoffs: BTreeMap<String, i64>,
    pub dismissed_suggestions: Vec<String>,
    pub retention: RetentionPolicy,
    pub last_cleanup_ms: f64,
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
            dashboard: DashboardConfig::default(),
            shortcuts: ShortcutsConfig::default(),
            themes: ThemesConfig::default(),
            plugins: PluginsConfig::default(),
            notification_rules: vec![],
            webhook_endpoints: vec![],
            onboarding_completed: false,
            maintenance_cutoffs: BTreeMap::new(),
            dismissed_suggestions: vec![],
            retention: RetentionPolicy::default(),
            last_cleanup_ms: 0.0,
        }
    }
}
