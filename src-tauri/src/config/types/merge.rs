use serde_json::Value;

use super::app::{AppConfig, PluginsConfig, ShortcutsConfig, ThemesConfig};
use super::dashboard::{BudgetConfig, DashboardConfig};
use super::general::{DisplayConfig, GeneralConfig};
use super::http::HttpServerConfig;
use super::notifications::NotificationConfig;
use super::sessions::SessionsConfig;
use super::ssh::SshPersistConfig;

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
            notif.triggers = crate::config::triggers::merge_triggers(
                &notif.triggers,
                &defaults.notifications.triggers,
            );
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

    let dashboard: DashboardConfig = match obj.get("dashboard") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.dashboard.clone(),
    };

    let shortcuts: ShortcutsConfig = match obj.get("shortcuts") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.shortcuts.clone(),
    };

    let themes: ThemesConfig = match obj.get("themes") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.themes.clone(),
    };

    let plugins: PluginsConfig = match obj.get("plugins") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => defaults.plugins.clone(),
    };

    let notification_rules: Vec<crate::notifications::types::NotificationRule> =
        match obj.get("notificationRules") {
            Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
            None => defaults.notification_rules.clone(),
        };

    let webhook_endpoints: Vec<crate::notifications::webhook::WebhookEndpoint> =
        match obj.get("webhookEndpoints") {
            Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
            None => defaults.webhook_endpoints.clone(),
        };

    let cache_max_sessions: usize = obj
        .get("cacheMaxSessions")
        .and_then(|v| v.as_u64())
        .map(|v| v.max(1) as usize)
        .unwrap_or(defaults.cache_max_sessions);

    let onboarding_completed: bool = obj
        .get("onboardingCompleted")
        .and_then(|v| v.as_bool())
        .unwrap_or(defaults.onboarding_completed);

    AppConfig {
        notifications,
        general,
        display,
        sessions,
        ssh,
        http_server,
        budget,
        dashboard,
        shortcuts,
        themes,
        plugins,
        notification_rules,
        webhook_endpoints,
        cache_max_sessions,
        onboarding_completed,
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
