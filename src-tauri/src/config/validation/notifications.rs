use serde_json::Value;

use super::predicates::{is_finite_number, is_string_array};
use crate::config::types::NotificationTrigger;

const MAX_SNOOZE_MINUTES: u32 = 24 * 60;

pub(super) fn validate_notifications(data: &Value) -> Result<Value, String> {
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
