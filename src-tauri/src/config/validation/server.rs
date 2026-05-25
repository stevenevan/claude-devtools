use serde_json::Value;

use super::predicates::is_valid_ssh_profile;

pub(super) fn validate_http_server(data: &Value) -> Result<Value, String> {
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

pub(super) fn validate_ssh(data: &Value) -> Result<Value, String> {
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
