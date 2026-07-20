//! Triggers: default set, merge, validation, mode inference. Mirrors the Go
//! oracle `internal/config/triggers.go`.

use regex::Regex;

use super::types::NotificationTrigger;

const MAX_PATTERN_LENGTH: usize = 100;

/// Builds a trigger with only the required scalar fields set; optional pointer
/// fields default to `None`. Keeps `default_triggers` terse.
fn base_trigger(id: &str, name: &str, content_type: &str, mode: &str) -> NotificationTrigger {
    NotificationTrigger {
        id: id.to_string(),
        name: name.to_string(),
        enabled: false,
        content_type: content_type.to_string(),
        mode: mode.to_string(),
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

/// Mirrors `triggers.go:DefaultTriggers`.
pub fn default_triggers() -> Vec<NotificationTrigger> {
    let mut env_access = base_trigger(
        "builtin-bash-command",
        ".env File Access Alert",
        "tool_use",
        "content_match",
    );
    env_access.match_pattern = Some("/.env".to_string());
    env_access.is_builtin = Some(true);
    env_access.color = Some("red".to_string());

    let mut tool_error = base_trigger(
        "builtin-tool-result-error",
        "Tool Result Error",
        "tool_result",
        "error_status",
    );
    tool_error.require_error = Some(true);
    tool_error.ignore_patterns = Some(vec![
        r"The user doesn't want to proceed with this tool use\.".to_string(),
        r"\[Request interrupted by user for tool use\]".to_string(),
    ]);
    tool_error.is_builtin = Some(true);
    tool_error.color = Some("orange".to_string());

    let mut high_tokens = base_trigger(
        "builtin-high-token-usage",
        "High Token Usage",
        "tool_result",
        "token_threshold",
    );
    high_tokens.token_threshold = Some(8000.0);
    high_tokens.token_type = Some("total".to_string());
    high_tokens.color = Some("yellow".to_string());
    high_tokens.is_builtin = Some(true);

    vec![env_access, tool_error, high_tokens]
}

/// Mirrors `triggers.go:isBuiltin`.
pub fn is_builtin_trigger(t: &NotificationTrigger) -> bool {
    t.is_builtin == Some(true)
}

/// Mirrors `triggers.go:MergeTriggers`: keep existing triggers, drop deprecated
/// builtins (builtin in loaded but not in defaults), add missing builtins.
pub fn merge_triggers(
    loaded: Vec<NotificationTrigger>,
    defaults: &[NotificationTrigger],
) -> Vec<NotificationTrigger> {
    let builtin_ids: std::collections::HashSet<&str> = defaults
        .iter()
        .filter(|t| is_builtin_trigger(t))
        .map(|t| t.id.as_str())
        .collect();

    let mut merged: Vec<NotificationTrigger> = loaded
        .into_iter()
        .filter(|t| !(is_builtin_trigger(t) && !builtin_ids.contains(t.id.as_str())))
        .collect();

    let existing: std::collections::HashSet<String> =
        merged.iter().map(|t| t.id.clone()).collect();
    for d in defaults {
        if is_builtin_trigger(d) && !existing.contains(&d.id) {
            merged.push(d.clone());
        }
    }
    merged
}

/// Mirrors `triggers.go:ValidateTrigger`. Returns validation error messages.
pub fn validate_trigger(t: &NotificationTrigger) -> Vec<String> {
    let mut errs = Vec::new();

    if t.id.is_empty() {
        errs.push("Trigger ID is required".to_string());
    }
    if t.name.is_empty() {
        errs.push("Trigger name is required".to_string());
    }
    if t.content_type.is_empty() {
        errs.push("Content type is required".to_string());
    }
    if t.mode.is_empty() {
        errs.push("Trigger mode is required".to_string());
    }

    match t.mode.as_str() {
        "content_match" => {
            let is_any_tool_use = t.content_type == "tool_use" && t.tool_name.is_none();
            if t.match_field.is_none() && !is_any_tool_use {
                errs.push("Match field is required for content_match mode".to_string());
            }
            if let Some(pattern) = &t.match_pattern {
                let err = validate_regex_pattern(pattern);
                if !err.is_empty() {
                    errs.push(err);
                }
            }
        }
        "token_threshold" => {
            if t.token_threshold.map(|v| v < 0.0).unwrap_or(true) {
                errs.push("Token threshold must be a non-negative number".to_string());
            }
            if t.token_type.is_none() {
                errs.push("Token type is required for token_threshold mode".to_string());
            }
        }
        _ => {}
    }

    if let Some(patterns) = &t.ignore_patterns {
        for p in patterns {
            let err = validate_regex_pattern(p);
            if !err.is_empty() {
                errs.push(format!("Invalid ignore pattern {p:?}: {err}"));
            }
        }
    }

    errs
}

/// Mirrors `triggers.go:ValidateRegexPattern`. Empty string = valid.
pub fn validate_regex_pattern(pattern: &str) -> String {
    if pattern.len() > MAX_PATTERN_LENGTH {
        return format!(
            "Pattern too long ({} chars, max {MAX_PATTERN_LENGTH})",
            pattern.len()
        );
    }
    match Regex::new(pattern) {
        Ok(_) => String::new(),
        Err(err) => format!("Invalid regex: {err}"),
    }
}

/// Mirrors `triggers.go:InferMode`.
pub fn infer_mode(t: &NotificationTrigger) -> String {
    if t.require_error == Some(true) {
        return "error_status".to_string();
    }
    if t.match_pattern.is_some() || t.match_field.is_some() {
        return "content_match".to_string();
    }
    if t.token_threshold.is_some() {
        return "token_threshold".to_string();
    }
    "error_status".to_string()
}

#[cfg(test)]
#[path = "triggers_tests.rs"]
mod tests;
