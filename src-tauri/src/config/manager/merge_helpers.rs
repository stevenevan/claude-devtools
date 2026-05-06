use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::config::types::{
    merge_config_with_defaults, AppConfig, DisplayConfig, GeneralConfig, HttpServerConfig,
    NotificationConfig, NotificationTrigger, SshPersistConfig,
};

pub(super) fn resolve_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".claude")
        .join("claude-devtools-config.json")
}

pub(super) fn load_config_from_disk(path: &std::path::Path) -> AppConfig {
    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(value) => merge_config_with_defaults(&value),
            Err(_) => AppConfig::default(),
        },
        Err(_) => AppConfig::default(),
    }
}

pub(super) fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

pub(super) fn merge_json_into_notifications(
    notif: &mut NotificationConfig,
    obj: &serde_json::Map<String, Value>,
) {
    if let Some(v) = obj.get("enabled").and_then(|v| v.as_bool()) {
        notif.enabled = v;
    }
    if let Some(v) = obj.get("soundEnabled").and_then(|v| v.as_bool()) {
        notif.sound_enabled = v;
    }
    if let Some(v) = obj.get("includeSubagentErrors").and_then(|v| v.as_bool()) {
        notif.include_subagent_errors = v;
    }
    if let Some(v) = obj.get("ignoredRegex") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            notif.ignored_regex = arr;
        }
    }
    if let Some(v) = obj.get("ignoredRepositories") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            notif.ignored_repositories = arr;
        }
    }
    if let Some(v) = obj.get("snoozedUntil") {
        notif.snoozed_until = v.as_f64();
    }
    if let Some(v) = obj.get("snoozeMinutes").and_then(|v| v.as_u64()) {
        notif.snooze_minutes = v as u32;
    }
    if let Some(v) = obj.get("triggers") {
        if let Ok(triggers) = serde_json::from_value::<Vec<NotificationTrigger>>(v.clone()) {
            notif.triggers = triggers;
        }
    }
}

pub(super) fn merge_json_into_general(general: &mut GeneralConfig, obj: &serde_json::Map<String, Value>) {
    if let Some(v) = obj.get("launchAtLogin").and_then(|v| v.as_bool()) {
        general.launch_at_login = v;
    }
    if let Some(v) = obj.get("showDockIcon").and_then(|v| v.as_bool()) {
        general.show_dock_icon = v;
    }
    if let Some(v) = obj.get("theme").and_then(|v| v.as_str()) {
        general.theme = v.to_string();
    }
    if let Some(v) = obj.get("defaultTab").and_then(|v| v.as_str()) {
        general.default_tab = v.to_string();
    }
    if let Some(v) = obj.get("claudeRootPath") {
        general.claude_root_path = if v.is_null() {
            None
        } else {
            v.as_str().map(|s| s.to_string())
        };
    }
    if let Some(v) = obj.get("autoExpandAIGroups").and_then(|v| v.as_bool()) {
        general.auto_expand_ai_groups = v;
    }
    if let Some(v) = obj.get("useNativeTitleBar").and_then(|v| v.as_bool()) {
        general.use_native_title_bar = v;
    }
}

pub(super) fn merge_json_into_display(display: &mut DisplayConfig, obj: &serde_json::Map<String, Value>) {
    if let Some(v) = obj.get("showTimestamps").and_then(|v| v.as_bool()) {
        display.show_timestamps = v;
    }
    if let Some(v) = obj.get("compactMode").and_then(|v| v.as_bool()) {
        display.compact_mode = v;
    }
    if let Some(v) = obj.get("syntaxHighlighting").and_then(|v| v.as_bool()) {
        display.syntax_highlighting = v;
    }
}

pub(super) fn merge_json_into_http_server(
    http: &mut HttpServerConfig,
    obj: &serde_json::Map<String, Value>,
) {
    if let Some(v) = obj.get("enabled").and_then(|v| v.as_bool()) {
        http.enabled = v;
    }
    if let Some(v) = obj.get("port").and_then(|v| v.as_u64()) {
        http.port = v as u16;
    }
}

pub(super) fn merge_json_into_ssh(ssh: &mut SshPersistConfig, obj: &serde_json::Map<String, Value>) {
    if let Some(v) = obj.get("autoReconnect").and_then(|v| v.as_bool()) {
        ssh.auto_reconnect = v;
    }
    if let Some(v) = obj.get("lastActiveContextId").and_then(|v| v.as_str()) {
        ssh.last_active_context_id = v.to_string();
    }
    if let Some(v) = obj.get("lastConnection") {
        if v.is_null() {
            ssh.last_connection = None;
        } else if let Ok(conn) = serde_json::from_value(v.clone()) {
            ssh.last_connection = Some(conn);
        }
    }
    if let Some(v) = obj.get("profiles") {
        if let Ok(profiles) = serde_json::from_value(v.clone()) {
            ssh.profiles = profiles;
        }
    }
}

pub(super) fn merge_trigger_updates(trigger: &mut NotificationTrigger, obj: &serde_json::Map<String, Value>) {
    if let Some(v) = obj.get("name").and_then(|v| v.as_str()) {
        trigger.name = v.to_string();
    }
    if let Some(v) = obj.get("enabled").and_then(|v| v.as_bool()) {
        trigger.enabled = v;
    }
    if let Some(v) = obj.get("contentType").and_then(|v| v.as_str()) {
        trigger.content_type = v.to_string();
    }
    if let Some(v) = obj.get("mode").and_then(|v| v.as_str()) {
        trigger.mode = v.to_string();
    }
    if let Some(v) = obj.get("toolName") {
        trigger.tool_name = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = obj.get("requireError") {
        trigger.require_error = v.as_bool();
    }
    if let Some(v) = obj.get("matchField") {
        trigger.match_field = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = obj.get("matchPattern") {
        trigger.match_pattern = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = obj.get("tokenThreshold") {
        trigger.token_threshold = v.as_f64();
    }
    if let Some(v) = obj.get("tokenType") {
        trigger.token_type = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = obj.get("ignorePatterns") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            trigger.ignore_patterns = Some(arr);
        }
    }
    if let Some(v) = obj.get("repositoryIds") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            trigger.repository_ids = Some(arr);
        }
    }
    if let Some(v) = obj.get("color") {
        trigger.color = v.as_str().map(|s| s.to_string());
    }
}
