//! `trigger_matcher` — regex pattern matching over a process-level LRU cache
//! (500 entries) plus the rule DSL evaluator. Ported from
//! `internal/notifications/trigger_matcher.go` (W14).

use std::num::NonZeroUsize;
use std::sync::{LazyLock, Mutex};

use lru::LruCache;
use regex::Regex;
use serde_json::Value;

use super::types::{NotificationRule, RuleEvalContext, RuleNode, RulePredicate};

const MAX_REGEX_CACHE_SIZE: usize = 500;

/// Process-level regex cache. `None` = pattern failed to compile (cached so we
/// never retry a bad pattern). Poison-free: a panic while the lock is held
/// cannot wedge the cache — we recover the inner guard.
static REGEX_CACHE: LazyLock<Mutex<LruCache<String, Option<Regex>>>> = LazyLock::new(|| {
    Mutex::new(LruCache::new(
        NonZeroUsize::new(MAX_REGEX_CACHE_SIZE).expect("cache size is non-zero"),
    ))
});

/// Compiled case-insensitive regex for `pattern`, or `None` for invalid patterns.
fn get_cached_regex(pattern: &str) -> Option<Regex> {
    let mut cache = REGEX_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = cache.get(pattern) {
        return entry.clone();
    }
    let compiled = Regex::new(&format!("(?i){pattern}")).ok();
    cache.put(pattern.to_string(), compiled.clone());
    compiled
}

/// True if `content` matches the (case-insensitive) regex `pattern`.
pub fn matches_pattern(content: &str, pattern: &str) -> bool {
    get_cached_regex(pattern).is_some_and(|re| re.is_match(content))
}

/// True if `content` matches any of the ignore patterns. Nil/empty → false.
pub fn matches_ignore_patterns(content: &str, ignore_patterns: Option<&[String]>) -> bool {
    let patterns = match ignore_patterns {
        Some(p) if !p.is_empty() => p,
        _ => return false,
    };
    patterns
        .iter()
        .any(|p| get_cached_regex(p).is_some_and(|re| re.is_match(content)))
}

/// Extracts a named field from a tool_use input object. String values are
/// returned as-is; other JSON types are stringified.
pub fn extract_tool_use_field(input: &Value, match_field: &str) -> Option<String> {
    let raw = input.as_object()?.get(match_field)?;
    match raw {
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

// ── Rule DSL evaluation ───────────────────────────────────────────────────────

/// Evaluates a single predicate against a context.
pub fn evaluate_predicate(predicate: &RulePredicate, ctx: &RuleEvalContext) -> bool {
    match predicate {
        RulePredicate::ToolName { equals } => ctx.tool_name.as_deref() == Some(equals.as_str()),
        RulePredicate::DurationGt { ms } => ctx.duration_ms.is_some_and(|d| d > *ms),
        RulePredicate::Error { is_error } => ctx.is_error == *is_error,
        RulePredicate::CostGt { usd } => ctx.cost_usd.is_some_and(|c| c > *usd),
        RulePredicate::RegexMatch { pattern } => ctx
            .message
            .as_ref()
            .is_some_and(|m| matches_pattern(m, pattern)),
    }
}

/// Recursively evaluates a rule node.
pub fn evaluate_node(node: &RuleNode, ctx: &RuleEvalContext) -> bool {
    match node {
        RuleNode::All { children } => children.iter().all(|c| evaluate_node(c, ctx)),
        RuleNode::Any { children } => children.iter().any(|c| evaluate_node(c, ctx)),
        RuleNode::Predicate { predicate } => evaluate_predicate(predicate, ctx),
    }
}

/// Evaluates every enabled rule and returns the IDs of rules that fired.
pub fn evaluate_rules(rules: &[NotificationRule], ctx: &RuleEvalContext) -> Vec<String> {
    rules
        .iter()
        .filter(|r| r.enabled)
        .filter(|r| evaluate_node(&r.condition, ctx))
        .map(|r| r.id.clone())
        .collect()
}

#[cfg(test)]
#[path = "trigger_matcher_tests.rs"]
mod tests;
