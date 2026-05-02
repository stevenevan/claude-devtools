/// TriggerMatcher — regex pattern matching with LRU cache.

use std::sync::Mutex;

use lru::LruCache;
use regex::Regex;
use serde_json::Value;

const MAX_CACHE_SIZE: usize = 500;

static REGEX_CACHE: Mutex<Option<LruCache<String, Option<Regex>>>> = Mutex::new(None);

fn with_cache<F, R>(f: F) -> R
where
    F: FnOnce(&mut LruCache<String, Option<Regex>>) -> R,
{
    let mut guard = REGEX_CACHE.lock().unwrap();
    let cache = guard.get_or_insert_with(|| {
        LruCache::new(std::num::NonZeroUsize::new(MAX_CACHE_SIZE).unwrap())
    });
    f(cache)
}

/// Get or compile a case-insensitive regex, returning None for invalid patterns.
fn get_cached_regex(pattern: &str) -> Option<Regex> {
    let key = pattern.to_string();

    with_cache(|cache| {
        if let Some(cached) = cache.get(&key) {
            return cached.clone();
        }

        // Build case-insensitive regex
        let compiled = Regex::new(&format!("(?i){pattern}")).ok();
        cache.put(key, compiled.clone());
        compiled
    })
}

// Pattern Matching

/// Checks if `content` matches a regex `pattern` (case-insensitive).
pub fn matches_pattern(content: &str, pattern: &str) -> bool {
    match get_cached_regex(pattern) {
        Some(re) => re.is_match(content),
        None => false,
    }
}

/// Checks if `content` matches any of the ignore patterns.
pub fn matches_ignore_patterns(content: &str, ignore_patterns: Option<&[String]>) -> bool {
    let patterns = match ignore_patterns {
        Some(p) if !p.is_empty() => p,
        _ => return false,
    };

    for pattern in patterns {
        if let Some(re) = get_cached_regex(pattern) {
            if re.is_match(content) {
                return true;
            }
        }
    }
    false
}

// Field Extraction

/// Extracts a named field from a tool_use input object.
pub fn extract_tool_use_field(input: &Value, match_field: &str) -> Option<String> {
    let obj = input.as_object()?;
    let value = obj.get(match_field)?;
    match value {
        Value::String(s) => Some(s.clone()),
        _ => Some(value.to_string()),
    }
}

// Rule DSL evaluation (sprint 40)

use super::types::{NotificationRule, RuleAction, RuleEvalContext, RuleNode, RulePredicate};

pub fn evaluate_predicate(p: &RulePredicate, ctx: &RuleEvalContext) -> bool {
    match p {
        RulePredicate::ToolName { equals } => ctx.tool_name == Some(equals.as_str()),
        RulePredicate::DurationGt { ms } => ctx.duration_ms.map(|d| d > *ms).unwrap_or(false),
        RulePredicate::Error { is_error } => ctx.is_error == *is_error,
        RulePredicate::CostGt { usd } => ctx.cost_usd.map(|c| c > *usd).unwrap_or(false),
        RulePredicate::RegexMatch { pattern } => match ctx.message {
            Some(m) => matches_pattern(m, pattern),
            None => false,
        },
    }
}

pub fn evaluate_node(node: &RuleNode, ctx: &RuleEvalContext) -> bool {
    match node {
        RuleNode::All { children } => children.iter().all(|c| evaluate_node(c, ctx)),
        RuleNode::Any { children } => children.iter().any(|c| evaluate_node(c, ctx)),
        RuleNode::Predicate { predicate } => evaluate_predicate(predicate, ctx),
    }
}

/// Dispatch the rule's action. `Webhook` is a typed stub in sprint 40 —
/// sprint 41 fills the dispatch body without changing the signature.
pub fn dispatch_action(action: &RuleAction) -> Result<(), String> {
    match action {
        RuleAction::Notify => Ok(()),
        RuleAction::Badge => Ok(()),
        RuleAction::Webhook { url, template } => {
            // Sprint 40: typed stub. Logged only — the real HTTP dispatch
            // is sprint 41's responsibility.
            let _ = url;
            let _ = template;
            eprintln!("[notifications] webhook dispatch stub: {url}");
            Ok(())
        }
    }
}

/// Evaluate every enabled rule and dispatch matching actions. Returns
/// the ids of rules that fired.
pub fn evaluate_rules(rules: &[NotificationRule], ctx: &RuleEvalContext) -> Vec<String> {
    let mut fired = Vec::new();
    for rule in rules.iter().filter(|r| r.enabled) {
        if evaluate_node(&rule.condition, ctx) {
            let _ = dispatch_action(&rule.action);
            fired.push(rule.id.clone());
        }
    }
    fired
}

// Tests

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_matches_pattern_basic() {
        assert!(matches_pattern("error: file not found", "error"));
        assert!(matches_pattern("ERROR: file not found", "error"));
        assert!(!matches_pattern("all good", "error"));
    }

    #[test]
    fn test_matches_pattern_regex() {
        assert!(matches_pattern("/Users/me/.env.local", r"\.env"));
        assert!(!matches_pattern("/Users/me/config.rs", r"\.env"));
    }

    #[test]
    fn test_matches_pattern_invalid_regex() {
        assert!(!matches_pattern("anything", "[invalid"));
    }

    #[test]
    fn test_matches_ignore_patterns_empty() {
        assert!(!matches_ignore_patterns("content", None));
        assert!(!matches_ignore_patterns("content", Some(&[])));
    }

    #[test]
    fn test_matches_ignore_patterns_matches() {
        let patterns = vec!["ignore_me".to_string(), "also_this".to_string()];
        assert!(matches_ignore_patterns("should ignore_me here", Some(&patterns)));
        assert!(!matches_ignore_patterns("no match", Some(&patterns)));
    }

    #[test]
    fn test_extract_tool_use_field_string() {
        let input = json!({"file_path": "/foo/bar.rs", "content": "hello"});
        assert_eq!(
            extract_tool_use_field(&input, "file_path"),
            Some("/foo/bar.rs".to_string())
        );
    }

    #[test]
    fn test_extract_tool_use_field_missing() {
        let input = json!({"file_path": "/foo/bar.rs"});
        assert_eq!(extract_tool_use_field(&input, "missing"), None);
    }

    #[test]
    fn test_extract_tool_use_field_non_string() {
        let input = json!({"count": 42});
        assert_eq!(
            extract_tool_use_field(&input, "count"),
            Some("42".to_string())
        );
    }

    // Sprint 40 — rule DSL evaluation

    fn ctx_for(message: &str, duration: f64) -> RuleEvalContext<'_> {
        RuleEvalContext {
            tool_name: Some("Bash"),
            duration_ms: Some(duration),
            is_error: false,
            cost_usd: None,
            message: Some(message),
        }
    }

    #[test]
    fn rule_all_matches_when_both_predicates_satisfied() {
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
    fn rule_any_matches_either_predicate() {
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
        ctx.tool_name = Some("Read");
        assert!(evaluate_node(&condition, &ctx));
    }

    #[test]
    fn webhook_action_returns_ok_stub() {
        let action = RuleAction::Webhook {
            url: "https://example.invalid/hook".to_string(),
            template: "{}".to_string(),
        };
        assert_eq!(dispatch_action(&action), Ok(()));
    }

    #[test]
    fn evaluate_rules_returns_only_enabled_matches() {
        let rules = vec![
            NotificationRule {
                id: "r1".into(),
                name: "match".into(),
                enabled: true,
                condition: RuleNode::Predicate {
                    predicate: RulePredicate::DurationGt { ms: 100.0 },
                },
                action: RuleAction::Notify,
            },
            NotificationRule {
                id: "r2".into(),
                name: "disabled-match".into(),
                enabled: false,
                condition: RuleNode::Predicate {
                    predicate: RulePredicate::DurationGt { ms: 100.0 },
                },
                action: RuleAction::Notify,
            },
        ];
        let ctx = ctx_for("anything", 1000.0);
        assert_eq!(evaluate_rules(&rules, &ctx), vec!["r1".to_string()]);
    }
}
