//! Ported from `internal/notifications/notifications_test.go` (trigger_matcher
//! cases). Included by trigger_matcher.rs via `#[path] mod tests;`.

use super::*;
use crate::notifications::types::{NotificationRule, RuleAction, RuleEvalContext, RuleNode, RulePredicate};
use serde_json::json;

fn ctx_for(message: &str, duration_ms: f64) -> RuleEvalContext {
    RuleEvalContext {
        tool_name: Some("Bash".to_string()),
        duration_ms: Some(duration_ms),
        is_error: false,
        cost_usd: None,
        message: Some(message.to_string()),
    }
}

#[test]
fn matches_pattern_basic() {
    assert!(matches_pattern("error: file not found", "error"));
    assert!(matches_pattern("ERROR: file not found", "error"));
    assert!(!matches_pattern("all good", "error"));
}

#[test]
fn matches_pattern_regex() {
    assert!(matches_pattern("/Users/me/.env.local", r"\.env"));
    assert!(!matches_pattern("/Users/me/config.rs", r"\.env"));
}

#[test]
fn matches_pattern_invalid_regex() {
    assert!(!matches_pattern("anything", "[invalid"));
}

#[test]
fn matches_ignore_patterns_empty() {
    assert!(!matches_ignore_patterns("content", None));
    let empty: Vec<String> = vec![];
    assert!(!matches_ignore_patterns("content", Some(&empty)));
}

#[test]
fn matches_ignore_patterns_matches() {
    let patterns = vec!["ignore_me".to_string(), "also_this".to_string()];
    assert!(matches_ignore_patterns("should ignore_me here", Some(&patterns)));
    assert!(!matches_ignore_patterns("no match", Some(&patterns)));
}

#[test]
fn extract_tool_use_field_string() {
    let input = json!({"file_path": "/foo/bar.rs", "content": "hello"});
    assert_eq!(
        extract_tool_use_field(&input, "file_path"),
        Some("/foo/bar.rs".to_string())
    );
}

#[test]
fn extract_tool_use_field_missing() {
    let input = json!({"file_path": "/foo/bar.rs"});
    assert_eq!(extract_tool_use_field(&input, "missing"), None);
}

#[test]
fn extract_tool_use_field_non_string() {
    let input = json!({"count": 42});
    assert_eq!(extract_tool_use_field(&input, "count"), Some("42".to_string()));
}

#[test]
fn rule_all_matches_when_both_satisfied() {
    let condition = RuleNode::All {
        children: vec![
            RuleNode::Predicate {
                predicate: RulePredicate::RegexMatch {
                    pattern: "TODO".to_string(),
                },
            },
            RuleNode::Predicate {
                predicate: RulePredicate::DurationGt { ms: 5000.0 },
            },
        ],
    };

    assert!(evaluate_node(&condition, &ctx_for("contains TODO marker", 6000.0)));
    assert!(!evaluate_node(&condition, &ctx_for("contains TODO marker", 1000.0)));
    assert!(!evaluate_node(&condition, &ctx_for("nope", 6000.0)));
}

#[test]
fn rule_any_matches_either() {
    let condition = RuleNode::Any {
        children: vec![
            RuleNode::Predicate {
                predicate: RulePredicate::ToolName {
                    equals: "Read".to_string(),
                },
            },
            RuleNode::Predicate {
                predicate: RulePredicate::DurationGt { ms: 1000.0 },
            },
        ],
    };

    assert!(evaluate_node(&condition, &ctx_for("ignored", 2000.0)));

    let mut ctx = ctx_for("ignored", 100.0);
    ctx.tool_name = Some("Read".to_string());
    assert!(evaluate_node(&condition, &ctx));
}

#[test]
fn evaluate_rules_only_enabled_matches() {
    let rules = vec![
        NotificationRule {
            id: "r1".to_string(),
            name: "match".to_string(),
            enabled: true,
            condition: RuleNode::Predicate {
                predicate: RulePredicate::DurationGt { ms: 100.0 },
            },
            action: RuleAction::Notify,
        },
        NotificationRule {
            id: "r2".to_string(),
            name: "disabled-match".to_string(),
            enabled: false,
            condition: RuleNode::Predicate {
                predicate: RulePredicate::DurationGt { ms: 100.0 },
            },
            action: RuleAction::Notify,
        },
    ];

    let fired = evaluate_rules(&rules, &ctx_for("anything", 1000.0));
    assert_eq!(fired, vec!["r1".to_string()]);
}
