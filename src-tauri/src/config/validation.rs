/// Config section validation matching `configValidation.ts`.

use serde_json::Value;

use super::types::NotificationTrigger;

const MAX_SNOOZE_MINUTES: u32 = 24 * 60;

// Top-level dispatcher

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
        _ => Err(
            "Section must be one of: notifications, general, display, httpServer, ssh, dashboard, shortcuts"
                .to_string(),
        ),
    }
}

fn validate_shortcuts(data: &Value) -> Result<Value, String> {
    let obj = data
        .as_object()
        .ok_or("shortcuts update must be an object")?;
    for key in obj.keys() {
        if key != "overrides" {
            return Err(format!("Unknown shortcuts field: {key}"));
        }
    }
    if let Some(overrides) = obj.get("overrides") {
        let overrides_obj = overrides
            .as_object()
            .ok_or("overrides must be an object")?;
        for (k, v) in overrides_obj {
            if k.is_empty() {
                return Err("shortcut override id must not be empty".to_string());
            }
            if !v.is_string() {
                return Err("shortcut override combo must be a string".to_string());
            }
        }
    }
    Ok(data.clone())
}

fn validate_dashboard(data: &Value) -> Result<Value, String> {
    let obj = data
        .as_object()
        .ok_or("dashboard update must be an object")?;
    for key in obj.keys() {
        if key != "widgetOrder" && key != "hiddenWidgets" {
            return Err(format!("Unknown dashboard field: {key}"));
        }
    }
    if let Some(order) = obj.get("widgetOrder") {
        let arr = order.as_array().ok_or("widgetOrder must be an array")?;
        for v in arr {
            if !v.is_string() {
                return Err("widgetOrder entries must be strings".to_string());
            }
        }
    }
    if let Some(hidden) = obj.get("hiddenWidgets") {
        let arr = hidden.as_array().ok_or("hiddenWidgets must be an array")?;
        for v in arr {
            if !v.is_string() {
                return Err("hiddenWidgets entries must be strings".to_string());
            }
        }
    }
    Ok(data.clone())
}

// Notifications

fn validate_notifications(data: &Value) -> Result<Value, String> {
    let obj = data
        .as_object()
        .ok_or("notifications update must be an object")?;

    let allowed = [
        "enabled",
        "soundEnabled",
        "includeSubagentErrors",
        "ignoredRegex",
        "ignoredRepositories",
        "snoozedUntil",
        "snoozeMinutes",
        "triggers",
    ];

    let mut result = serde_json::Map::new();

    for (key, value) in obj {
        if !allowed.contains(&key.as_str()) {
            return Err(format!(
                "notifications.{key} is not supported via config:update"
            ));
        }

        match key.as_str() {
            "enabled" | "soundEnabled" | "includeSubagentErrors" => {
                if !value.is_boolean() {
                    return Err(format!("notifications.{key} must be a boolean"));
                }
                result.insert(key.clone(), value.clone());
            }
            "ignoredRegex" | "ignoredRepositories" => {
                if !is_string_array(value) {
                    return Err(format!("notifications.{key} must be a string[]"));
                }
                result.insert(key.clone(), value.clone());
            }
            "snoozedUntil" => {
                if !value.is_null() && !is_finite_number(value) {
                    return Err("notifications.snoozedUntil must be a number or null".to_string());
                }
                if let Some(n) = value.as_f64() {
                    if n < 0.0 {
                        return Err("notifications.snoozedUntil must be >= 0".to_string());
                    }
                }
                result.insert(key.clone(), value.clone());
            }
            "snoozeMinutes" => {
                let n = value
                    .as_u64()
                    .ok_or("notifications.snoozeMinutes must be an integer")?;
                if n == 0 || n > MAX_SNOOZE_MINUTES as u64 {
                    return Err(format!(
                        "notifications.snoozeMinutes must be between 1 and {MAX_SNOOZE_MINUTES}"
                    ));
                }
                result.insert(key.clone(), value.clone());
            }
            "triggers" => {
                let arr = value
                    .as_array()
                    .ok_or("notifications.triggers must be a valid trigger[]")?;
                for trigger_val in arr {
                    let trigger: NotificationTrigger = serde_json::from_value(trigger_val.clone())
                        .map_err(|_| {
                            "notifications.triggers must be a valid trigger[]".to_string()
                        })?;
                    // Basic structural validation (id, name, contentType, mode present)
                    if trigger.id.trim().is_empty()
                        || trigger.name.trim().is_empty()
                        || trigger.content_type.is_empty()
                        || trigger.mode.is_empty()
                    {
                        return Err(
                            "notifications.triggers must be a valid trigger[]".to_string()
                        );
                    }
                }
                result.insert(key.clone(), value.clone());
            }
            _ => {}
        }
    }

    Ok(Value::Object(result))
}

// General

fn validate_general(data: &Value) -> Result<Value, String> {
    let obj = data
        .as_object()
        .ok_or("general update must be an object")?;

    let allowed = [
        "launchAtLogin",
        "showDockIcon",
        "theme",
        "defaultTab",
        "claudeRootPath",
        "autoExpandAIGroups",
        "useNativeTitleBar",
    ];

    let mut result = serde_json::Map::new();

    for (key, value) in obj {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("general.{key} is not a valid setting"));
        }

        match key.as_str() {
            "launchAtLogin" | "showDockIcon" | "autoExpandAIGroups" | "useNativeTitleBar" => {
                if !value.is_boolean() {
                    return Err(format!("general.{key} must be a boolean"));
                }
                result.insert(key.clone(), value.clone());
            }
            "theme" => {
                let s = value
                    .as_str()
                    .ok_or("general.theme must be one of: dark, light, system")?;
                if !["dark", "light", "system"].contains(&s) {
                    return Err("general.theme must be one of: dark, light, system".to_string());
                }
                result.insert(key.clone(), value.clone());
            }
            "defaultTab" => {
                let s = value
                    .as_str()
                    .ok_or("general.defaultTab must be one of: dashboard, last-session")?;
                if !["dashboard", "last-session"].contains(&s) {
                    return Err(
                        "general.defaultTab must be one of: dashboard, last-session".to_string(),
                    );
                }
                result.insert(key.clone(), value.clone());
            }
            "claudeRootPath" => {
                if value.is_null() {
                    result.insert(key.clone(), Value::Null);
                } else if let Some(s) = value.as_str() {
                    let trimmed = s.trim();
                    if trimmed.is_empty() {
                        result.insert(key.clone(), Value::Null);
                    } else {
                        let p = std::path::Path::new(trimmed);
                        if !p.is_absolute() {
                            return Err(
                                "general.claudeRootPath must be an absolute path".to_string()
                            );
                        }
                        // Normalize: resolve and store
                        let resolved = std::fs::canonicalize(p)
                            .unwrap_or_else(|_| p.to_path_buf())
                            .to_string_lossy()
                            .to_string();
                        result.insert(key.clone(), Value::String(resolved));
                    }
                } else {
                    return Err(
                        "general.claudeRootPath must be an absolute path string or null"
                            .to_string(),
                    );
                }
            }
            _ => {}
        }
    }

    Ok(Value::Object(result))
}

// Display

fn validate_display(data: &Value) -> Result<Value, String> {
    let obj = data
        .as_object()
        .ok_or("display update must be an object")?;

    let allowed = ["showTimestamps", "compactMode", "syntaxHighlighting"];
    let mut result = serde_json::Map::new();

    for (key, value) in obj {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("display.{key} is not a valid setting"));
        }
        if !value.is_boolean() {
            return Err(format!("display.{key} must be a boolean"));
        }
        result.insert(key.clone(), value.clone());
    }

    Ok(Value::Object(result))
}

// HTTP Server

fn validate_http_server(data: &Value) -> Result<Value, String> {
    let obj = data
        .as_object()
        .ok_or("httpServer update must be an object")?;

    let allowed = ["enabled", "port"];
    let mut result = serde_json::Map::new();

    for (key, value) in obj {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("httpServer.{key} is not a valid setting"));
        }

        match key.as_str() {
            "enabled" => {
                if !value.is_boolean() {
                    return Err("httpServer.enabled must be a boolean".to_string());
                }
                result.insert(key.clone(), value.clone());
            }
            "port" => {
                let n = value
                    .as_u64()
                    .ok_or("httpServer.port must be an integer between 1024 and 65535")?;
                if !(1024..=65535).contains(&n) {
                    return Err(
                        "httpServer.port must be an integer between 1024 and 65535".to_string(),
                    );
                }
                result.insert(key.clone(), value.clone());
            }
            _ => {}
        }
    }

    Ok(Value::Object(result))
}

// SSH

fn validate_ssh(data: &Value) -> Result<Value, String> {
    let obj = data.as_object().ok_or("ssh update must be an object")?;

    let allowed = [
        "lastConnection",
        "autoReconnect",
        "profiles",
        "lastActiveContextId",
    ];

    let mut result = serde_json::Map::new();

    for (key, value) in obj {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("ssh.{key} is not a valid setting"));
        }

        match key.as_str() {
            "autoReconnect" => {
                if !value.is_boolean() {
                    return Err("ssh.autoReconnect must be a boolean".to_string());
                }
                result.insert(key.clone(), value.clone());
            }
            "lastActiveContextId" => {
                if !value.is_string() {
                    return Err("ssh.lastActiveContextId must be a string".to_string());
                }
                result.insert(key.clone(), value.clone());
            }
            "lastConnection" => {
                if !value.is_null() && !value.is_object() {
                    return Err("ssh.lastConnection must be an object or null".to_string());
                }
                result.insert(key.clone(), value.clone());
            }
            "profiles" => {
                let arr = value
                    .as_array()
                    .ok_or("ssh.profiles must be a valid profile array")?;
                for profile in arr {
                    if !is_valid_ssh_profile(profile) {
                        return Err("ssh.profiles must be a valid profile array".to_string());
                    }
                }
                result.insert(key.clone(), value.clone());
            }
            _ => {}
        }
    }

    Ok(Value::Object(result))
}

// Helpers

fn is_string_array(value: &Value) -> bool {
    match value.as_array() {
        Some(arr) => arr.iter().all(|v| v.is_string()),
        None => false,
    }
}

fn is_finite_number(value: &Value) -> bool {
    match value.as_f64() {
        Some(n) => n.is_finite(),
        None => false,
    }
}

fn is_valid_ssh_profile(profile: &Value) -> bool {
    let obj = match profile.as_object() {
        Some(o) => o,
        None => return false,
    };

    let has_non_empty_string = |key: &str| -> bool {
        obj.get(key)
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    };

    if !has_non_empty_string("id") {
        return false;
    }
    if obj.get("name").and_then(|v| v.as_str()).is_none() {
        return false;
    }
    if obj.get("host").and_then(|v| v.as_str()).is_none() {
        return false;
    }
    if obj.get("port").and_then(|v| v.as_u64()).is_none() {
        return false;
    }
    if obj.get("username").and_then(|v| v.as_str()).is_none() {
        return false;
    }

    let valid_methods = ["password", "privateKey", "agent", "auto"];
    match obj.get("authMethod").and_then(|v| v.as_str()) {
        Some(m) => valid_methods.contains(&m),
        None => false,
    }
}

// Validation helper for trigger add/update in manager


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_valid_general_update() {
        let data = json!({ "theme": "light", "launchAtLogin": true });
        assert!(validate_config_update("general", &data).is_ok());
    }

    #[test]
    fn test_reject_invalid_theme() {
        let data = json!({ "theme": "neon" });
        assert!(validate_config_update("general", &data).is_err());
    }

    #[test]
    fn test_reject_unknown_section() {
        let data = json!({});
        assert!(validate_config_update("unknown", &data).is_err());
    }

    #[test]
    fn test_reject_unknown_notification_key() {
        let data = json!({ "unknownKey": true });
        assert!(validate_config_update("notifications", &data).is_err());
    }

    #[test]
    fn test_null_claude_root_path() {
        let data = json!({ "claudeRootPath": null });
        let result = validate_config_update("general", &data).unwrap();
        assert!(result.1.get("claudeRootPath").unwrap().is_null());
    }

    #[test]
    fn test_display_boolean_validation() {
        let data = json!({ "showTimestamps": "yes" });
        assert!(validate_config_update("display", &data).is_err());
    }

    #[test]
    fn test_valid_display_update() {
        let data = json!({ "compactMode": true });
        assert!(validate_config_update("display", &data).is_ok());
    }

    #[test]
    fn test_http_server_port_range() {
        let data = json!({ "port": 80 });
        assert!(validate_config_update("httpServer", &data).is_err());

        let data = json!({ "port": 3000 });
        assert!(validate_config_update("httpServer", &data).is_ok());
    }

    #[test]
    fn test_snooze_minutes_range() {
        let data = json!({ "snoozeMinutes": 0 });
        assert!(validate_config_update("notifications", &data).is_err());

        let data = json!({ "snoozeMinutes": 60 });
        assert!(validate_config_update("notifications", &data).is_ok());
    }
}
