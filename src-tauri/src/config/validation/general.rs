use serde_json::Value;

pub(super) fn validate_general(data: &Value) -> Result<Value, String> {
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

pub(super) fn validate_display(data: &Value) -> Result<Value, String> {
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
