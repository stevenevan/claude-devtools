/// LRU cache with TTL for parsed session data.

use std::num::NonZeroUsize;
use std::time::{Duration, Instant};

use lru::LruCache;

use crate::types::domain::ParsedSession;

/// Cached entry with expiration tracking.
struct CacheEntry {
    value: ParsedSession,
    inserted_at: Instant,
}

/// Thread-safe LRU cache for parsed sessions.
/// Matching the TypeScript DataCache: 50 entries, 10-min TTL.
pub struct SessionCache {
    inner: LruCache<String, CacheEntry>,
    ttl: Duration,
}

impl SessionCache {
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            inner: LruCache::new(NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(50).unwrap())),
            ttl,
        }
    }

    /// Get a cached session if it exists and hasn't expired.
    pub fn get(&mut self, key: &str) -> Option<&ParsedSession> {
        let entry = self.inner.get(key)?;
        if entry.inserted_at.elapsed() > self.ttl {
            self.inner.pop(key);
            return None;
        }
        // Re-borrow after mutation check
        self.inner.get(key).map(|e| &e.value)
    }

    /// Insert a parsed session into the cache.
    pub fn insert(&mut self, key: String, value: ParsedSession) {
        self.inner.put(
            key,
            CacheEntry {
                value,
                inserted_at: Instant::now(),
            },
        );
    }

}

#[cfg(test)]
impl SessionCache {
    pub fn invalidate(&mut self, key: &str) {
        self.inner.pop(key);
    }

    pub fn invalidate_project(&mut self, project_id: &str) {
        let prefix = format!("{project_id}/");
        let keys_to_remove: Vec<String> = self
            .inner
            .iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .map(|(k, _)| k.clone())
            .collect();
        for key in keys_to_remove {
            self.inner.pop(&key);
        }
    }
}

impl Default for SessionCache {
    fn default() -> Self {
        Self::new(50, Duration::from_secs(600))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::domain::{MessagesByType, SessionMetrics};

    fn make_session() -> ParsedSession {
        ParsedSession {
            messages: vec![],
            metrics: SessionMetrics::default(),
            task_calls: vec![],
            by_type: MessagesByType {
                user: vec![],
                real_user: vec![],
                internal_user: vec![],
                assistant: vec![],
                system: vec![],
                other: vec![],
            },
            sidechain_messages: vec![],
            main_messages: vec![],
            custom_title: None,
            agent_name: None,
        }
    }

    #[test]
    fn test_insert_and_get() {
        let mut cache = SessionCache::default();
        cache.insert("proj/sess1".to_string(), make_session());
        assert!(cache.get("proj/sess1").is_some());
        assert!(cache.get("proj/sess2").is_none());
    }

    #[test]
    fn test_invalidate() {
        let mut cache = SessionCache::default();
        cache.insert("proj/sess1".to_string(), make_session());
        cache.invalidate("proj/sess1");
        assert!(cache.get("proj/sess1").is_none());
    }

    #[test]
    fn test_invalidate_project() {
        let mut cache = SessionCache::default();
        cache.insert("proj1/sess1".to_string(), make_session());
        cache.insert("proj1/sess2".to_string(), make_session());
        cache.insert("proj2/sess1".to_string(), make_session());
        cache.invalidate_project("proj1");
        assert!(cache.get("proj1/sess1").is_none());
        assert!(cache.get("proj1/sess2").is_none());
        assert!(cache.get("proj2/sess1").is_some());
    }

    #[test]
    fn test_ttl_expiration() {
        let mut cache = SessionCache::new(50, Duration::from_millis(1));
        cache.insert("proj/sess1".to_string(), make_session());
        std::thread::sleep(Duration::from_millis(10));
        assert!(cache.get("proj/sess1").is_none());
    }
}
