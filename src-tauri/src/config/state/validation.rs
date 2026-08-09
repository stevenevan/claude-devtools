//! Config-update validation. Entry point: `validate_config_update(section, data)`
//! → canonicalised `Value` or an error. Mirrors the Go oracle
//! `internal/config/validation.go` clamp/default/whitelist rules VERBATIM.
//!
//! Judgment calls vs Go's lenient `encoding/json`: where Go unmarshals a partial
//! object into a struct (missing fields → Go zero values), Rust `serde` requires
//! every non-`Option`/non-`default` field. `notifications.triggers` and
//! `retention.categories` therefore require the frontend to send complete
//! objects (it always does); a partial hand-edit is rejected rather than
//! zero-filled. Numeric parsing matches Go's `json.Number` semantics: an integer
//! literal (`80`) is a u64, a float literal (`80.0`) is not (`as_u64` → None),
//! so a non-integer port/minutes value is rejected exactly as in Go.

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::{Map, Value};

use super::manager::clamp_cutoff_days;
use super::types::{NotificationTrigger, RetentionCategory};

const MAX_SNOOZE_MINUTES: u64 = 24 * 60;

/// Mirrors `validation.go:ValidateConfigUpdate`. Returns the validated /
/// canonicalised value (the Go tuple's section echo is dropped — the caller
/// already knows it).
pub fn validate_config_update(section: &str, data: &Value) -> Result<Value, String> {
    match section {
        "notifications" => validate_notifications(data),
        "general" => validate_general(data),
        "display" => validate_display(data),
        "httpServer" => validate_http_server(data),
        "ssh" => validate_ssh(data),
        "dashboard" => validate_dashboard(data),
        "shortcuts" => validate_shortcuts(data),
        "themes" => validate_themes(data),
        "plugins" => validate_plugins(data),
        "notificationRules" => validate_notification_rules(data),
        "webhookEndpoints" => validate_webhook_endpoints(data),
        "onboarding" => validate_onboarding(data),
        "retention" => validate_retention(data),
        _ => Err("Section must be one of: notifications, general, display, httpServer, ssh, dashboard, shortcuts, themes, plugins, notificationRules, webhookEndpoints, onboarding, retention".to_string()),
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

fn parse_obj<'a>(data: &'a Value, context: &str) -> Result<&'a Map<String, Value>, String> {
    data.as_object()
        .ok_or_else(|| format!("{context} update must be an object"))
}

fn is_string_array(raw: &Value) -> bool {
    raw.as_array()
        .map(|arr| arr.iter().all(Value::is_string))
        .unwrap_or(false)
}

fn is_finite_number(raw: &Value) -> bool {
    raw.as_f64().map(f64::is_finite).unwrap_or(false)
}

// ─── general ─────────────────────────────────────────────────────────────────

const ALLOWED_GENERAL_KEYS: [&str; 7] = [
    "launchAtLogin",
    "uiMode",
    "theme",
    "defaultTab",
    "claudeRootPath",
    "autoExpandAIGroups",
    "useNativeTitleBar",
];
const BOOL_GENERAL_KEYS: [&str; 3] = ["launchAtLogin", "autoExpandAIGroups", "useNativeTitleBar"];
const VALID_UI_MODES: [&str; 2] = ["simple", "nerd"];
const VALID_THEMES: [&str; 3] = ["dark", "light", "system"];
const VALID_DEFAULT_TABS: [&str; 2] = ["dashboard", "last-session"];

fn validate_general(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "general")?;
    let mut result = Map::new();
    for (k, v) in obj {
        if !ALLOWED_GENERAL_KEYS.contains(&k.as_str()) {
            return Err(format!("general.{k} is not a valid setting"));
        }
        if BOOL_GENERAL_KEYS.contains(&k.as_str()) {
            if !v.is_boolean() {
                return Err(format!("general.{k} must be a boolean"));
            }
            result.insert(k.clone(), v.clone());
        } else if k == "uiMode" {
            match v.as_str() {
                Some(s) if VALID_UI_MODES.contains(&s) => {}
                _ => return Err("general.uiMode must be one of: simple, nerd".to_string()),
            }
            result.insert(k.clone(), v.clone());
        } else if k == "theme" {
            match v.as_str() {
                Some(s) if VALID_THEMES.contains(&s) => {}
                _ => return Err("general.theme must be one of: dark, light, system".to_string()),
            }
            result.insert(k.clone(), v.clone());
        } else if k == "defaultTab" {
            match v.as_str() {
                Some(s) if VALID_DEFAULT_TABS.contains(&s) => {}
                _ => {
                    return Err(
                        "general.defaultTab must be one of: dashboard, last-session".to_string()
                    )
                }
            }
            result.insert(k.clone(), v.clone());
        } else if k == "claudeRootPath" {
            if v.is_null() {
                result.insert(k.clone(), Value::Null);
            } else if let Some(s) = v.as_str() {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    result.insert(k.clone(), Value::Null);
                } else if !Path::new(trimmed).is_absolute() {
                    return Err("general.claudeRootPath must be an absolute path".to_string());
                } else {
                    // Canonicalize best-effort (Go: filepath.EvalSymlinks, falls
                    // back to the trimmed value when the path doesn't exist).
                    let resolved = std::fs::canonicalize(trimmed)
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_else(|_| trimmed.to_string());
                    result.insert(k.clone(), Value::String(resolved));
                }
            } else {
                return Err(
                    "general.claudeRootPath must be an absolute path string or null".to_string(),
                );
            }
        }
    }
    Ok(Value::Object(result))
}

// ─── display ─────────────────────────────────────────────────────────────────

// allowedDisplayKeys is empty — any key is rejected before the bool check (matches Go).
fn validate_display(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "display")?;
    if let Some(k) = obj.keys().next() {
        return Err(format!("display.{k} is not a valid setting"));
    }
    Ok(Value::Object(Map::new()))
}

// ─── notifications ────────────────────────────────────────────────────────────

const ALLOWED_NOTIF_KEYS: [&str; 8] = [
    "enabled",
    "soundEnabled",
    "includeSubagentErrors",
    "ignoredRegex",
    "ignoredRepositories",
    "snoozedUntil",
    "snoozeMinutes",
    "triggers",
];
const BOOL_NOTIF_KEYS: [&str; 3] = ["enabled", "soundEnabled", "includeSubagentErrors"];

fn validate_notifications(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "notifications")?;
    let mut result = Map::new();
    for (k, v) in obj {
        if !ALLOWED_NOTIF_KEYS.contains(&k.as_str()) {
            return Err(format!("notifications.{k} is not supported via config:update"));
        }
        if BOOL_NOTIF_KEYS.contains(&k.as_str()) {
            if !v.is_boolean() {
                return Err(format!("notifications.{k} must be a boolean"));
            }
            result.insert(k.clone(), v.clone());
        } else if k == "ignoredRegex" || k == "ignoredRepositories" {
            if !is_string_array(v) {
                return Err(format!("notifications.{k} must be a string[]"));
            }
            result.insert(k.clone(), v.clone());
        } else if k == "snoozedUntil" {
            if !v.is_null() && !is_finite_number(v) {
                return Err("notifications.snoozedUntil must be a number or null".to_string());
            }
            if is_finite_number(v) {
                if v.as_f64().unwrap_or(0.0) < 0.0 {
                    return Err("notifications.snoozedUntil must be >= 0".to_string());
                }
            }
            result.insert(k.clone(), v.clone());
        } else if k == "snoozeMinutes" {
            let n = v
                .as_u64()
                .ok_or_else(|| "notifications.snoozeMinutes must be an integer".to_string())?;
            if n == 0 || n > MAX_SNOOZE_MINUTES {
                return Err(format!(
                    "notifications.snoozeMinutes must be between 1 and {MAX_SNOOZE_MINUTES}"
                ));
            }
            result.insert(k.clone(), v.clone());
        } else if k == "triggers" {
            let arr = v
                .as_array()
                .ok_or_else(|| "notifications.triggers must be a valid trigger[]".to_string())?;
            for tv in arr {
                let t: NotificationTrigger = serde_json::from_value(tv.clone())
                    .map_err(|_| "notifications.triggers must be a valid trigger[]".to_string())?;
                if t.id.trim().is_empty()
                    || t.name.trim().is_empty()
                    || t.content_type.is_empty()
                    || t.mode.is_empty()
                {
                    return Err("notifications.triggers must be a valid trigger[]".to_string());
                }
            }
            result.insert(k.clone(), v.clone());
        }
    }
    Ok(Value::Object(result))
}

// ─── httpServer ───────────────────────────────────────────────────────────────

const ALLOWED_HTTP_KEYS: [&str; 2] = ["enabled", "port"];

fn validate_http_server(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "httpServer")?;
    let mut result = Map::new();
    for (k, v) in obj {
        if !ALLOWED_HTTP_KEYS.contains(&k.as_str()) {
            return Err(format!("httpServer.{k} is not a valid setting"));
        }
        match k.as_str() {
            "enabled" => {
                if !v.is_boolean() {
                    return Err("httpServer.enabled must be a boolean".to_string());
                }
                result.insert(k.clone(), v.clone());
            }
            "port" => {
                let ok = v.as_u64().map(|n| (1024..=65535).contains(&n)).unwrap_or(false);
                if !ok {
                    return Err(
                        "httpServer.port must be an integer between 1024 and 65535".to_string()
                    );
                }
                result.insert(k.clone(), v.clone());
            }
            _ => {}
        }
    }
    Ok(Value::Object(result))
}

// ─── ssh ──────────────────────────────────────────────────────────────────────

const ALLOWED_SSH_KEYS: [&str; 4] =
    ["lastConnection", "autoReconnect", "profiles", "lastActiveContextId"];
const VALID_AUTH_METHODS: [&str; 4] = ["password", "privateKey", "agent", "auto"];

fn is_valid_ssh_profile(raw: &Value) -> bool {
    let Some(m) = raw.as_object() else {
        return false;
    };
    let non_empty = |key: &str| {
        m.get(key)
            .and_then(Value::as_str)
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    };
    if !non_empty("id") {
        return false;
    }
    for req in ["name", "host", "username"] {
        if m.get(req).and_then(Value::as_str).is_none() {
            return false;
        }
    }
    if m.get("port").and_then(Value::as_u64).is_none() {
        return false;
    }
    match m.get("authMethod").and_then(Value::as_str) {
        Some(method) => VALID_AUTH_METHODS.contains(&method),
        None => false,
    }
}

fn validate_ssh(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "ssh")?;
    let mut result = Map::new();
    for (k, v) in obj {
        if !ALLOWED_SSH_KEYS.contains(&k.as_str()) {
            return Err(format!("ssh.{k} is not a valid setting"));
        }
        match k.as_str() {
            "autoReconnect" => {
                if !v.is_boolean() {
                    return Err("ssh.autoReconnect must be a boolean".to_string());
                }
                result.insert(k.clone(), v.clone());
            }
            "lastActiveContextId" => {
                if !v.is_string() {
                    return Err("ssh.lastActiveContextId must be a string".to_string());
                }
                result.insert(k.clone(), v.clone());
            }
            "lastConnection" => {
                if !v.is_null() && !v.is_object() {
                    return Err("ssh.lastConnection must be an object or null".to_string());
                }
                result.insert(k.clone(), v.clone());
            }
            "profiles" => {
                let arr = v
                    .as_array()
                    .ok_or_else(|| "ssh.profiles must be a valid profile array".to_string())?;
                for p in arr {
                    if !is_valid_ssh_profile(p) {
                        return Err("ssh.profiles must be a valid profile array".to_string());
                    }
                }
                result.insert(k.clone(), v.clone());
            }
            _ => {}
        }
    }
    Ok(Value::Object(result))
}

// ─── dashboard ────────────────────────────────────────────────────────────────

const ALLOWED_DASHBOARD_KEYS: [&str; 2] = ["widgetOrder", "hiddenWidgets"];

fn validate_dashboard(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "dashboard")?;
    for k in obj.keys() {
        if !ALLOWED_DASHBOARD_KEYS.contains(&k.as_str()) {
            return Err(format!("Unknown dashboard field: {k}"));
        }
    }
    for key in ["widgetOrder", "hiddenWidgets"] {
        if let Some(v) = obj.get(key) {
            if !is_string_array(v) {
                return Err(format!("{key} entries must be strings"));
            }
        }
    }
    Ok(data.clone())
}

// ─── shortcuts ────────────────────────────────────────────────────────────────

fn validate_shortcuts(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "shortcuts")?;
    for k in obj.keys() {
        if k != "overrides" {
            return Err(format!("Unknown shortcuts field: {k}"));
        }
    }
    if let Some(v) = obj.get("overrides") {
        let m = v
            .as_object()
            .ok_or_else(|| "overrides must be an object".to_string())?;
        for (k2, v2) in m {
            if k2.is_empty() {
                return Err("shortcut override id must not be empty".to_string());
            }
            if !v2.is_string() {
                return Err("shortcut override combo must be a string".to_string());
            }
        }
    }
    Ok(data.clone())
}

// ─── themes ───────────────────────────────────────────────────────────────────

fn validate_themes(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "themes")?;
    for k in obj.keys() {
        if k != "activeId" && k != "custom" {
            return Err(format!("Unknown themes field: {k}"));
        }
    }
    if let Some(v) = obj.get("activeId") {
        if !v.is_null() && !v.is_string() {
            return Err("activeId must be a string or null".to_string());
        }
    }
    if let Some(v) = obj.get("custom") {
        let arr = v
            .as_array()
            .ok_or_else(|| "custom must be an array".to_string())?;
        for entry in arr {
            let theme = entry
                .as_object()
                .ok_or_else(|| "theme entry must be an object".to_string())?;
            for f in ["id", "name", "basedOn"] {
                match theme.get(f) {
                    None => return Err(format!("theme missing field: {f}")),
                    Some(fv) if !fv.is_string() => {
                        return Err(format!("theme.{f} must be a string"))
                    }
                    Some(_) => {}
                }
            }
            let based_on = theme.get("basedOn").and_then(Value::as_str).unwrap_or("");
            if based_on != "dark" && based_on != "light" {
                return Err("theme.basedOn must be 'dark' or 'light'".to_string());
            }
            let overrides = theme
                .get("overrides")
                .and_then(Value::as_object)
                .ok_or_else(|| "theme.overrides must be an object".to_string())?;
            for (k2, v2) in overrides {
                if k2.is_empty() {
                    return Err("theme override key must not be empty".to_string());
                }
                if !v2.is_string() {
                    return Err("theme override value must be a string".to_string());
                }
            }
        }
    }
    Ok(data.clone())
}

// ─── plugins ──────────────────────────────────────────────────────────────────

fn validate_plugins(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "plugins")?;
    for k in obj.keys() {
        if k != "enabled" {
            return Err(format!("Unknown plugins field: {k}"));
        }
    }
    if let Some(v) = obj.get("enabled") {
        let arr = v
            .as_array()
            .ok_or_else(|| "enabled must be an array".to_string())?;
        for entry in arr {
            if !entry.is_string() {
                return Err("enabled entries must be strings".to_string());
            }
        }
    }
    Ok(data.clone())
}

// ─── notificationRules / webhookEndpoints ─────────────────────────────────────

fn validate_notification_rules(data: &Value) -> Result<Value, String> {
    if !data.is_array() {
        return Err("notificationRules update must be an array".to_string());
    }
    Ok(data.clone())
}

fn validate_webhook_endpoints(data: &Value) -> Result<Value, String> {
    if !data.is_array() {
        return Err("webhookEndpoints update must be an array".to_string());
    }
    Ok(data.clone())
}

// ─── retention (W31) ──────────────────────────────────────────────────────────

const ALLOWED_RETENTION_KEYS: [&str; 3] = ["categories", "trashExpiryDays", "scheduleInterval"];
const VALID_SCHEDULE_INTERVALS: [&str; 3] = ["off", "weekly", "monthly"];

fn validate_retention(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "retention")?;
    let mut result = Map::new();
    for (k, v) in obj {
        if !ALLOWED_RETENTION_KEYS.contains(&k.as_str()) {
            return Err(format!("retention.{k} is not a valid setting"));
        }
        match k.as_str() {
            "categories" => {
                if serde_json::from_value::<BTreeMap<String, RetentionCategory>>(v.clone()).is_err()
                {
                    return Err(
                        "retention.categories must be a map of {enabled, autoApproved}".to_string(),
                    );
                }
                result.insert(k.clone(), v.clone());
            }
            "trashExpiryDays" => {
                if !is_finite_number(v) {
                    return Err("retention.trashExpiryDays must be a number".to_string());
                }
                // Clamp to [1,36500] (Security F5): a 0/negative window would
                // EmptyTrash same-pass receipts irreversibly in an unattended run.
                let clamped = clamp_cutoff_days(v.as_f64().unwrap_or(0.0) as i64);
                result.insert(k.clone(), Value::from(clamped));
            }
            "scheduleInterval" => {
                let ok = v
                    .as_str()
                    .map(|s| VALID_SCHEDULE_INTERVALS.contains(&s))
                    .unwrap_or(false);
                if !ok {
                    return Err(
                        "retention.scheduleInterval must be one of: off, weekly, monthly".to_string(),
                    );
                }
                result.insert(k.clone(), v.clone());
            }
            _ => {}
        }
    }
    Ok(Value::Object(result))
}

// ─── onboarding ───────────────────────────────────────────────────────────────

fn validate_onboarding(data: &Value) -> Result<Value, String> {
    let obj = parse_obj(data, "onboarding")?;
    for k in obj.keys() {
        if k != "completed" {
            return Err(format!("Unknown onboarding field: {k}"));
        }
    }
    if let Some(v) = obj.get("completed") {
        if !v.is_boolean() {
            return Err("completed must be a boolean".to_string());
        }
    }
    Ok(data.clone())
}

#[cfg(test)]
mod tests {
    use super::super::manager::{merge_retention_with_defaults, normalize_schedule_interval};
    use super::*;
    use crate::config::state::types::RetentionPolicy;
    use std::collections::BTreeMap;

    fn validated_map(section: &str, body: &str) -> Map<String, Value> {
        let data: Value = serde_json::from_str(body).unwrap();
        let out = validate_config_update(section, &data).unwrap();
        out.as_object().cloned().unwrap_or_default()
    }

    #[test]
    fn valid_general_update() {
        let data = serde_json::json!({"theme": "light", "launchAtLogin": true});
        assert!(validate_config_update("general", &data).is_ok());
    }

    #[test]
    fn valid_ui_modes() {
        for mode in ["simple", "nerd"] {
            let data = serde_json::json!({"uiMode": mode});
            assert!(validate_config_update("general", &data).is_ok());
        }
    }

    #[test]
    fn reject_invalid_ui_mode() {
        let data = serde_json::json!({"uiMode": "expert"});
        assert_eq!(
            validate_config_update("general", &data),
            Err("general.uiMode must be one of: simple, nerd".to_string())
        );
    }

    #[test]
    fn reject_invalid_theme() {
        let data = serde_json::json!({"theme": "neon"});
        assert!(validate_config_update("general", &data).is_err());
    }

    #[test]
    fn reject_unknown_section() {
        let data = serde_json::json!({});
        assert!(validate_config_update("unknown", &data).is_err());
    }

    #[test]
    fn reject_unknown_notification_key() {
        let data = serde_json::json!({"unknownKey": true});
        assert!(validate_config_update("notifications", &data).is_err());
    }

    #[test]
    fn null_claude_root_path() {
        let data = serde_json::json!({"claudeRootPath": null});
        let out = validate_config_update("general", &data).unwrap();
        let obj = out.as_object().unwrap();
        assert_eq!(obj.get("claudeRootPath"), Some(&Value::Null));
    }

    #[test]
    fn http_server_port_range() {
        assert!(validate_config_update("httpServer", &serde_json::json!({"port": 80})).is_err());
        assert!(validate_config_update("httpServer", &serde_json::json!({"port": 3000})).is_ok());
    }

    #[test]
    fn snooze_minutes_range() {
        assert!(
            validate_config_update("notifications", &serde_json::json!({"snoozeMinutes": 0}))
                .is_err()
        );
        assert!(
            validate_config_update("notifications", &serde_json::json!({"snoozeMinutes": 60}))
                .is_ok()
        );
    }

    #[test]
    fn validate_retention_clamps_expiry() {
        let clamped = |body: &str| -> i64 {
            let m = validated_map("retention", body);
            m.get("trashExpiryDays").unwrap().as_i64().unwrap()
        };
        assert_eq!(clamped(r#"{"trashExpiryDays":0}"#), 1);
        assert_eq!(clamped(r#"{"trashExpiryDays":-9}"#), 1);
        assert_eq!(clamped(r#"{"trashExpiryDays":45}"#), 45);

        let bogus: Value = serde_json::from_str(r#"{"bogus":1}"#).unwrap();
        assert!(validate_config_update("retention", &bogus).is_err());
    }

    #[test]
    fn validate_schedule_interval() {
        for ok in ["off", "weekly", "monthly"] {
            let body = format!(r#"{{"scheduleInterval":"{ok}"}}"#);
            let data: Value = serde_json::from_str(&body).unwrap();
            assert!(validate_config_update("retention", &data).is_ok(), "{ok}");
        }
        for bad in ["daily", "hourly", "", "WEEKLY"] {
            let body = format!(r#"{{"scheduleInterval":"{bad}"}}"#);
            let data: Value = serde_json::from_str(&body).unwrap();
            assert!(validate_config_update("retention", &data).is_err(), "{bad}");
        }

        assert_eq!(RetentionPolicy::default().schedule_interval, "off");
        let zero = RetentionPolicy {
            categories: BTreeMap::new(),
            trash_expiry_days: 0,
            schedule_interval: String::new(),
        };
        let merged = merge_retention_with_defaults(zero, RetentionPolicy::default());
        assert_eq!(merged.schedule_interval, "off");
        assert_eq!(normalize_schedule_interval(""), "off");
    }
}
