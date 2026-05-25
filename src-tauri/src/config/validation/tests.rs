use serde_json::json;

use super::dispatcher::validate_config_update;

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
