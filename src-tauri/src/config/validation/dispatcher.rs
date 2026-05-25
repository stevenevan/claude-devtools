use serde_json::Value;

use super::general::{validate_display, validate_general};
use super::misc::{
    validate_dashboard, validate_notification_rules, validate_onboarding, validate_plugins,
    validate_shortcuts, validate_themes, validate_webhook_endpoints,
};
use super::notifications::validate_notifications;
use super::server::{validate_http_server, validate_ssh};

/// Validate a config update payload. Returns validated (section, data) or error.
pub fn validate_config_update(section: &str, data: &Value) -> Result<(String, Value), String> {
    match section {
        "notifications" => validate_notifications(data).map(|v| (section.to_string(), v)),
        "general" => validate_general(data).map(|v| (section.to_string(), v)),
        "display" => validate_display(data).map(|v| (section.to_string(), v)),
        "httpServer" => validate_http_server(data).map(|v| (section.to_string(), v)),
        "ssh" => validate_ssh(data).map(|v| (section.to_string(), v)),
        "dashboard" => validate_dashboard(data).map(|v| (section.to_string(), v)),
        "shortcuts" => validate_shortcuts(data).map(|v| (section.to_string(), v)),
        "themes" => validate_themes(data).map(|v| (section.to_string(), v)),
        "plugins" => validate_plugins(data).map(|v| (section.to_string(), v)),
        "notificationRules" => validate_notification_rules(data).map(|v| (section.to_string(), v)),
        "webhookEndpoints" => validate_webhook_endpoints(data).map(|v| (section.to_string(), v)),
        "onboarding" => validate_onboarding(data).map(|v| (section.to_string(), v)),
        _ => Err(
            "Section must be one of: notifications, general, display, httpServer, ssh, dashboard, shortcuts, themes, plugins, notificationRules, webhookEndpoints, onboarding"
                .to_string(),
        ),
    }
}
