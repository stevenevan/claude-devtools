/// TriggerMatcher — regex pattern matching with LRU cache.

use std::sync::Mutex;

use lru::LruCache;
use regex::Regex;
use serde_json::Value;

// =============================================================================
// Regex Cache
// =============================================================================

const MAX_CACHE_SIZE: usize = 500;

/// Thread-safe regex cache.
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

// =============================================================================
// Pattern Matching
// =============================================================================

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

// =============================================================================
// Field Extraction
// =============================================================================

/// Extracts a named field from a tool_use input object.
pub fn extract_tool_use_field(input: &Value, match_field: &str) -> Option<String> {
    let obj = input.as_object()?;
    let value = obj.get(match_field)?;
    match value {
        Value::String(s) => Some(s.clone()),
        _ => Some(value.to_string()),
    }
}

// =============================================================================
// Tests
// =============================================================================

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
}
