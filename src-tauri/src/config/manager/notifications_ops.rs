use std::collections::HashMap;

use serde_json::Value;

use super::super::triggers;
use super::super::types::{AppConfig, CustomTheme};
use super::super::validation;
use super::ConfigState;
use super::merge_helpers::{
    merge_json_into_display, merge_json_into_general, merge_json_into_http_server,
    merge_json_into_notifications, merge_json_into_ssh, now_millis,
};
use crate::notifications::types::NotificationRule;
use crate::notifications::webhook::WebhookEndpoint;

impl ConfigState {
    // =========================================================================
    // Section Update
    // =========================================================================

    /// Update a config section with validated partial data.
    pub fn update_config(&mut self, section: &str, data: &Value) -> Result<AppConfig, String> {
        let (section, validated) = validation::validate_config_update(section, data)?;

        match section.as_str() {
            "notifications" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_notifications(&mut self.config.notifications, obj);
            }
            "general" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_general(&mut self.config.general, obj);
            }
            "display" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_display(&mut self.config.display, obj);
            }
            "httpServer" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_http_server(&mut self.config.http_server, obj);
            }
            "ssh" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_ssh(&mut self.config.ssh, obj);
            }
            "dashboard" => {
                let obj = validated.as_object().unwrap();
                if let Some(order) = obj.get("widgetOrder").and_then(|v| v.as_array()) {
                    self.config.dashboard.widget_order = order
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                }
                if let Some(hidden) = obj.get("hiddenWidgets").and_then(|v| v.as_array()) {
                    self.config.dashboard.hidden_widgets = hidden
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                }
            }
            "shortcuts" => {
                let obj = validated.as_object().unwrap();
                if let Some(overrides) = obj.get("overrides").and_then(|v| v.as_object()) {
                    let mut next = HashMap::new();
                    for (k, v) in overrides {
                        if let Some(s) = v.as_str() {
                            next.insert(k.clone(), s.to_string());
                        }
                    }
                    self.config.shortcuts.overrides = next;
                }
            }
            "themes" => {
                let obj = validated.as_object().unwrap();
                if let Some(active) = obj.get("activeId") {
                    self.config.themes.active_id = active.as_str().map(|s| s.to_string());
                }
                if let Some(arr) = obj.get("custom").and_then(|v| v.as_array()) {
                    let mut themes: Vec<CustomTheme> = Vec::new();
                    for entry in arr {
                        if let Ok(theme) = serde_json::from_value::<CustomTheme>(entry.clone()) {
                            themes.push(theme);
                        }
                    }
                    self.config.themes.custom = themes;
                }
            }
            "plugins" => {
                let obj = validated.as_object().unwrap();
                if let Some(enabled) = obj.get("enabled").and_then(|v| v.as_array()) {
                    self.config.plugins.enabled = enabled
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                }
            }
            "notificationRules" => {
                if let Some(arr) = validated.as_array() {
                    let mut rules: Vec<NotificationRule> = Vec::new();
                    for entry in arr {
                        if let Ok(rule) = serde_json::from_value::<NotificationRule>(entry.clone())
                        {
                            rules.push(rule);
                        }
                    }
                    self.config.notification_rules = rules;
                }
            }
            "webhookEndpoints" => {
                if let Some(arr) = validated.as_array() {
                    let mut eps: Vec<WebhookEndpoint> = Vec::new();
                    for entry in arr {
                        if let Ok(ep) = serde_json::from_value::<WebhookEndpoint>(entry.clone()) {
                            eps.push(ep);
                        }
                    }
                    self.config.webhook_endpoints = eps;
                }
            }
            "onboarding" => {
                let obj = validated.as_object().unwrap();
                if let Some(v) = obj.get("completed").and_then(|v| v.as_bool()) {
                    self.config.onboarding_completed = v;
                }
            }
            _ => {}
        }

        self.save_config();
        Ok(self.get_config())
    }

    // =========================================================================
    // Ignore Regex
    // =========================================================================

    pub fn add_ignore_regex(&mut self, pattern: &str) -> Result<AppConfig, String> {
        let trimmed = pattern.trim();
        if trimmed.is_empty() {
            return Ok(self.get_config());
        }

        triggers::validate_regex_pattern(trimmed)?;

        if self
            .config
            .notifications
            .ignored_regex
            .contains(&trimmed.to_string())
        {
            return Ok(self.get_config());
        }

        self.config
            .notifications
            .ignored_regex
            .push(trimmed.to_string());
        self.save_config();
        Ok(self.get_config())
    }

    pub fn remove_ignore_regex(&mut self, pattern: &str) -> AppConfig {
        self.config
            .notifications
            .ignored_regex
            .retain(|p| p != pattern);
        self.save_config();
        self.get_config()
    }

    // =========================================================================
    // Ignore Repository
    // =========================================================================

    pub fn add_ignore_repository(&mut self, repository_id: &str) -> Result<AppConfig, String> {
        let trimmed = repository_id.trim();
        if trimmed.is_empty() {
            return Ok(self.get_config());
        }

        if self
            .config
            .notifications
            .ignored_repositories
            .contains(&trimmed.to_string())
        {
            return Ok(self.get_config());
        }

        self.config
            .notifications
            .ignored_repositories
            .push(trimmed.to_string());
        self.save_config();
        Ok(self.get_config())
    }

    pub fn remove_ignore_repository(&mut self, repository_id: &str) -> AppConfig {
        self.config
            .notifications
            .ignored_repositories
            .retain(|r| r != repository_id);
        self.save_config();
        self.get_config()
    }

    // =========================================================================
    // Snooze
    // =========================================================================

    pub fn snooze(&mut self, minutes: Option<u32>) -> AppConfig {
        let snooze_minutes = minutes.unwrap_or(self.config.notifications.snooze_minutes);
        let now_ms = now_millis();
        let until = now_ms + (snooze_minutes as f64) * 60_000.0;
        self.config.notifications.snoozed_until = Some(until);
        self.save_config();
        self.get_config()
    }

    pub fn clear_snooze(&mut self) -> AppConfig {
        self.config.notifications.snoozed_until = None;
        self.save_config();
        self.get_config()
    }
}
