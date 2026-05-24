use serde::{Deserialize, Serialize};

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
            triggers: crate::config::triggers::default_triggers(),
        }
    }
}
