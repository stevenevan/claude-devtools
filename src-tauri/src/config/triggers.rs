/// Notification trigger management: defaults, merging, and validation.

use super::types::NotificationTrigger;

// Default Built-in Triggers

pub fn default_triggers() -> Vec<NotificationTrigger> {
    vec![
        NotificationTrigger {
            id: "builtin-bash-command".to_string(),
            name: ".env File Access Alert".to_string(),
            enabled: false,
            content_type: "tool_use".to_string(),
            mode: "content_match".to_string(),
            match_pattern: Some("/.env".to_string()),
            is_builtin: Some(true),
            color: Some("red".to_string()),
            tool_name: None,
            ignore_patterns: None,
            require_error: None,
            match_field: None,
            token_threshold: None,
            token_type: None,
            repository_ids: None,
        },
        NotificationTrigger {
            id: "builtin-tool-result-error".to_string(),
            name: "Tool Result Error".to_string(),
            enabled: false,
            content_type: "tool_result".to_string(),
            mode: "error_status".to_string(),
            require_error: Some(true),
            ignore_patterns: Some(vec![
                r"The user doesn't want to proceed with this tool use\.".to_string(),
                r"\[Request interrupted by user for tool use\]".to_string(),
            ]),
            is_builtin: Some(true),
            color: Some("orange".to_string()),
            tool_name: None,
            match_field: None,
            match_pattern: None,
            token_threshold: None,
            token_type: None,
            repository_ids: None,
        },
        NotificationTrigger {
            id: "builtin-high-token-usage".to_string(),
            name: "High Token Usage".to_string(),
            enabled: false,
            content_type: "tool_result".to_string(),
            mode: "token_threshold".to_string(),
            token_threshold: Some(8000.0),
            token_type: Some("total".to_string()),
            color: Some("yellow".to_string()),
            is_builtin: Some(true),
            tool_name: None,
            ignore_patterns: None,
            require_error: None,
            match_field: None,
            match_pattern: None,
            repository_ids: None,
        },
    ]
}

// Trigger Merging

/// Merge loaded triggers with defaults.
/// - Preserves all existing triggers (including user-modified builtins)
/// - Adds any missing builtin triggers from defaults
/// - Removes deprecated builtin triggers not in defaults
pub fn merge_triggers(
    loaded: &[NotificationTrigger],
    defaults: &[NotificationTrigger],
) -> Vec<NotificationTrigger> {
    let builtin_ids: std::collections::HashSet<&str> = defaults
        .iter()
        .filter(|t| t.is_builtin == Some(true))
        .map(|t| t.id.as_str())
        .collect();

    // Filter out deprecated builtins
    let mut merged: Vec<NotificationTrigger> = loaded
        .iter()
        .filter(|t| t.is_builtin != Some(true) || builtin_ids.contains(t.id.as_str()))
        .cloned()
        .collect();

    // Add missing builtins
    for default_trigger in defaults {
        if default_trigger.is_builtin == Some(true)
            && !merged.iter().any(|t| t.id == default_trigger.id)
        {
            merged.push(default_trigger.clone());
        }
    }

    merged
}

// Trigger Validation

const MAX_PATTERN_LENGTH: usize = 100;

/// Validate a trigger configuration. Returns Ok(()) or Err with error messages.
pub fn validate_trigger(trigger: &NotificationTrigger) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    if trigger.id.trim().is_empty() {
        errors.push("Trigger ID is required".to_string());
    }
    if trigger.name.trim().is_empty() {
        errors.push("Trigger name is required".to_string());
    }
    if trigger.content_type.is_empty() {
        errors.push("Content type is required".to_string());
    }
    if trigger.mode.is_empty() {
        errors.push("Trigger mode is required".to_string());
    }

    // Mode-specific validation
    match trigger.mode.as_str() {
        "content_match" => {
            // matchField required unless tool_use with no toolName (matches entire JSON)
            let is_any_tool_use =
                trigger.content_type == "tool_use" && trigger.tool_name.is_none();
            if trigger.match_field.is_none() && !is_any_tool_use {
                errors.push("Match field is required for content_match mode".to_string());
            }
            if let Some(ref pattern) = trigger.match_pattern {
                if let Err(e) = validate_regex_pattern(pattern) {
                    errors.push(e);
                }
            }
        }
        "token_threshold" => {
            match trigger.token_threshold {
                Some(t) if t < 0.0 => {
                    errors.push("Token threshold must be a non-negative number".to_string());
                }
                None => {
                    errors.push("Token threshold must be a non-negative number".to_string());
                }
                _ => {}
            }
            if trigger.token_type.is_none() {
                errors.push("Token type is required for token_threshold mode".to_string());
            }
        }
        _ => {} // error_status or unknown — no extra fields needed
    }

    // Validate ignore patterns
    if let Some(ref patterns) = trigger.ignore_patterns {
        for pattern in patterns {
            if let Err(e) = validate_regex_pattern(pattern) {
                errors.push(format!("Invalid ignore pattern \"{pattern}\": {e}"));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Validate a regex pattern: max length + compilability.
/// Rust's regex crate uses Thompson NFA — no catastrophic backtracking.
pub fn validate_regex_pattern(pattern: &str) -> Result<(), String> {
    if pattern.len() > MAX_PATTERN_LENGTH {
        return Err(format!(
            "Pattern too long ({} chars, max {MAX_PATTERN_LENGTH})",
            pattern.len()
        ));
    }
    regex::Regex::new(pattern)
        .map(|_| ())
        .map_err(|e| format!("Invalid regex: {e}"))
}

/// Infer trigger mode from properties for backward compatibility.
pub fn infer_mode(trigger: &NotificationTrigger) -> String {
    if trigger.require_error == Some(true) {
        return "error_status".to_string();
    }
    if trigger.match_pattern.is_some() || trigger.match_field.is_some() {
        return "content_match".to_string();
    }
    if trigger.token_threshold.is_some() {
        return "token_threshold".to_string();
    }
    "error_status".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_triggers_count() {
        assert_eq!(default_triggers().len(), 3);
    }

    #[test]
    fn test_merge_adds_missing_builtins() {
        let loaded = vec![]; // no triggers loaded
        let defaults = default_triggers();
        let merged = merge_triggers(&loaded, &defaults);
        assert_eq!(merged.len(), 3);
    }

    #[test]
    fn test_merge_preserves_user_triggers() {
        let mut loaded = default_triggers();
        loaded.push(NotificationTrigger {
            id: "user-custom".to_string(),
            name: "Custom".to_string(),
            enabled: true,
            content_type: "text".to_string(),
            mode: "content_match".to_string(),
            is_builtin: None,
            ..default_trigger_template()
        });
        let defaults = default_triggers();
        let merged = merge_triggers(&loaded, &defaults);
        assert_eq!(merged.len(), 4);
        assert!(merged.iter().any(|t| t.id == "user-custom"));
    }

    #[test]
    fn test_merge_removes_deprecated_builtins() {
        let loaded = vec![NotificationTrigger {
            id: "builtin-deprecated".to_string(),
            name: "Old".to_string(),
            enabled: false,
            content_type: "text".to_string(),
            mode: "error_status".to_string(),
            is_builtin: Some(true),
            ..default_trigger_template()
        }];
        let defaults = default_triggers();
        let merged = merge_triggers(&loaded, &defaults);
        assert!(!merged.iter().any(|t| t.id == "builtin-deprecated"));
        assert_eq!(merged.len(), 3); // only defaults
    }

    #[test]
    fn test_validate_trigger_valid() {
        let trigger = &default_triggers()[0];
        assert!(validate_trigger(trigger).is_ok());
    }

    #[test]
    fn test_validate_trigger_missing_id() {
        let mut trigger = default_triggers()[0].clone();
        trigger.id = "".to_string();
        let result = validate_trigger(&trigger);
        assert!(result.is_err());
        assert!(result.unwrap_err()[0].contains("ID"));
    }

    #[test]
    fn test_validate_regex_pattern_valid() {
        assert!(validate_regex_pattern(r"\.env").is_ok());
    }

    #[test]
    fn test_validate_regex_pattern_invalid() {
        assert!(validate_regex_pattern(r"(unclosed").is_err());
    }

    #[test]
    fn test_validate_regex_pattern_too_long() {
        let long = "a".repeat(101);
        assert!(validate_regex_pattern(&long).is_err());
    }

    #[test]
    fn test_infer_mode() {
        let mut t = default_trigger_template();
        t.require_error = Some(true);
        assert_eq!(infer_mode(&t), "error_status");

        t.require_error = None;
        t.match_pattern = Some("test".to_string());
        assert_eq!(infer_mode(&t), "content_match");

        t.match_pattern = None;
        t.token_threshold = Some(100.0);
        assert_eq!(infer_mode(&t), "token_threshold");
    }

    fn default_trigger_template() -> NotificationTrigger {
        NotificationTrigger {
            id: String::new(),
            name: String::new(),
            enabled: false,
            content_type: String::new(),
            mode: String::new(),
            tool_name: None,
            is_builtin: None,
            ignore_patterns: None,
            require_error: None,
            match_field: None,
            match_pattern: None,
            token_threshold: None,
            token_type: None,
            repository_ids: None,
            color: None,
        }
    }
}
