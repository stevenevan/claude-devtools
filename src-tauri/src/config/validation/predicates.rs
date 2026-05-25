use serde_json::Value;

pub(super) fn is_string_array(value: &Value) -> bool {
    match value.as_array() {
        Some(arr) => arr.iter().all(|v| v.is_string()),
        None => false,
    }
}

pub(super) fn is_finite_number(value: &Value) -> bool {
    match value.as_f64() {
        Some(n) => n.is_finite(),
        None => false,
    }
}

pub(super) fn is_valid_ssh_profile(profile: &Value) -> bool {
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
