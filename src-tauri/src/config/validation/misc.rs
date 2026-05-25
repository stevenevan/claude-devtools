use serde_json::Value;

pub(super) fn validate_onboarding(data: &Value) -> Result<Value, String> {
    let obj = data.as_object().ok_or("onboarding update must be an object")?;
    for key in obj.keys() {
        if key != "completed" {
            return Err(format!("Unknown onboarding field: {key}"));
        }
    }
    if let Some(v) = obj.get("completed") {
        if !v.is_boolean() {
            return Err("completed must be a boolean".to_string());
        }
    }
    Ok(data.clone())
}

pub(super) fn validate_webhook_endpoints(data: &Value) -> Result<Value, String> {
    if !data.is_array() {
        return Err("webhookEndpoints update must be an array".to_string());
    }
    Ok(data.clone())
}

pub(super) fn validate_notification_rules(data: &Value) -> Result<Value, String> {
    if !data.is_array() {
        return Err("notificationRules update must be an array".to_string());
    }
    Ok(data.clone())
}

pub(super) fn validate_plugins(data: &Value) -> Result<Value, String> {
    let obj = data.as_object().ok_or("plugins update must be an object")?;
    for key in obj.keys() {
        if key != "enabled" {
            return Err(format!("Unknown plugins field: {key}"));
        }
    }
    if let Some(list) = obj.get("enabled") {
        let arr = list.as_array().ok_or("enabled must be an array")?;
        for entry in arr {
            if !entry.is_string() {
                return Err("enabled entries must be strings".to_string());
            }
        }
    }
    Ok(data.clone())
}

pub(super) fn validate_themes(data: &Value) -> Result<Value, String> {
    let obj = data.as_object().ok_or("themes update must be an object")?;
    for key in obj.keys() {
        if key != "activeId" && key != "custom" {
            return Err(format!("Unknown themes field: {key}"));
        }
    }
    if let Some(active) = obj.get("activeId") {
        if !active.is_null() && !active.is_string() {
            return Err("activeId must be a string or null".to_string());
        }
    }
    if let Some(custom) = obj.get("custom") {
        let arr = custom.as_array().ok_or("custom must be an array")?;
        for entry in arr {
            let theme = entry.as_object().ok_or("theme entry must be an object")?;
            for f in ["id", "name", "basedOn"] {
                let v = theme.get(f).ok_or(format!("theme missing field: {f}"))?;
                if !v.is_string() {
                    return Err(format!("theme.{f} must be a string"));
                }
            }
            let based = theme["basedOn"].as_str().unwrap_or("");
            if based != "dark" && based != "light" {
                return Err("theme.basedOn must be 'dark' or 'light'".to_string());
            }
            let overrides = theme
                .get("overrides")
                .and_then(|v| v.as_object())
                .ok_or("theme.overrides must be an object")?;
            for (k, v) in overrides {
                if k.is_empty() {
                    return Err("theme override key must not be empty".to_string());
                }
                if !v.is_string() {
                    return Err("theme override value must be a string".to_string());
                }
            }
        }
    }
    Ok(data.clone())
}

pub(super) fn validate_shortcuts(data: &Value) -> Result<Value, String> {
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

pub(super) fn validate_dashboard(data: &Value) -> Result<Value, String> {
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
