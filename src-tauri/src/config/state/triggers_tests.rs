//! Ported from `internal/config/triggers_test.go`. Included by triggers.rs via
//! `#[path = "triggers_tests.rs"] mod tests;`, so `super::*` is the triggers API.

use super::*;
use crate::config::state::types::NotificationTrigger;

/// A minimal trigger with every optional field cleared, for merge/infer tests.
fn base(id: &str, name: &str, content_type: &str, mode: &str) -> NotificationTrigger {
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

#[test]
fn default_triggers_count() {
    assert_eq!(default_triggers().len(), 3);
}

#[test]
fn merge_adds_missing_builtins() {
    let merged = merge_triggers(vec![], &default_triggers());
    assert_eq!(merged.len(), 3);
}

#[test]
fn merge_preserves_user_triggers() {
    let mut loaded = default_triggers();
    loaded.push(base("user-custom", "Custom", "text", "content_match"));
    let merged = merge_triggers(loaded, &default_triggers());
    assert_eq!(merged.len(), 4);
    assert!(merged.iter().any(|m| m.id == "user-custom"));
}

#[test]
fn merge_removes_deprecated_builtins() {
    let mut deprecated = base("builtin-deprecated", "Old", "text", "error_status");
    deprecated.is_builtin = Some(true);
    let merged = merge_triggers(vec![deprecated], &default_triggers());
    assert!(!merged.iter().any(|m| m.id == "builtin-deprecated"));
    assert_eq!(merged.len(), 3);
}

#[test]
fn validate_trigger_valid() {
    let defaults = default_triggers();
    assert!(validate_trigger(&defaults[0]).is_empty());
}

#[test]
fn validate_trigger_missing_id() {
    let mut trigger = default_triggers()[0].clone();
    trigger.id = String::new();
    let errs = validate_trigger(&trigger);
    assert!(!errs.is_empty());
    assert!(errs[0].contains("ID"));
}

#[test]
fn validate_regex_pattern_valid() {
    assert_eq!(validate_regex_pattern(r"\.env"), "");
}

#[test]
fn validate_regex_pattern_invalid() {
    assert!(!validate_regex_pattern("(unclosed").is_empty());
}

#[test]
fn validate_regex_pattern_too_long() {
    let long = "a".repeat(101);
    assert!(!validate_regex_pattern(&long).is_empty());
}

#[test]
fn infer_mode_cases() {
    let mut t1 = base("", "", "", "");
    t1.require_error = Some(true);
    assert_eq!(infer_mode(&t1), "error_status");

    let mut t2 = base("", "", "", "");
    t2.match_pattern = Some("test".to_string());
    assert_eq!(infer_mode(&t2), "content_match");

    let mut t3 = base("", "", "", "");
    t3.token_threshold = Some(100.0);
    assert_eq!(infer_mode(&t3), "token_threshold");
}
