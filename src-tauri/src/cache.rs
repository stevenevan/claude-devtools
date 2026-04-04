/// LRU cache with TTL for parsed session data.

use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::time::{Duration, Instant};

use lru::LruCache;

use crate::parsing::session_parser::SessionFileMetadata;
use crate::types::domain::ParsedSession;

/// Cached entry with expiration tracking.
struct CacheEntry {
    value: ParsedSession,
    inserted_at: Instant,
}

/// Tracks incremental parsing state for a session file.
#[derive(Debug, Clone)]
pub struct IncrementalState {
    /// Byte offset of the last successfully parsed position.
    pub byte_offset: u64,
    /// Accumulated metadata from all lines parsed so far.
    pub metadata: SessionFileMetadata,
}

pub struct SessionCache {
    inner: LruCache<String, CacheEntry>,
    ttl: Duration,
    /// Tracks incremental parsing state per session (keyed by cache key).
    incremental: HashMap<String, IncrementalState>,
}

impl SessionCache {
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            inner: LruCache::new(NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(50).unwrap())),
            ttl,
            incremental: HashMap::new(),
        }
    }

    pub fn get(&mut self, key: &str) -> Option<&ParsedSession> {
        let entry = self.inner.get(key)?;
        if entry.inserted_at.elapsed() > self.ttl {
            self.inner.pop(key);
            return None;
        }
        // Re-borrow after mutation check
        self.inner.get(key).map(|e| &e.value)
    }

    pub fn insert(&mut self, key: String, value: ParsedSession) {
        self.inner.put(
            key,
            CacheEntry {
                value,
                inserted_at: Instant::now(),
            },
        );
    }

    pub fn get_incremental(&self, key: &str) -> Option<&IncrementalState> {
        self.incremental.get(key)
    }

    pub fn set_incremental(&mut self, key: String, state: IncrementalState) {
        self.incremental.insert(key, state);
    }

    pub fn remove_incremental(&mut self, key: &str) {
        self.incremental.remove(key);
    }

}

#[cfg(test)]
impl SessionCache {
    pub fn invalidate(&mut self, key: &str) {
        self.inner.pop(key);
        self.incremental.remove(key);
    }

    pub fn invalidate_project(&mut self, project_id: &str) {
        let prefix = format!("{project_id}/");
        let keys_to_remove: Vec<String> = self
            .inner
            .iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .map(|(k, _)| k.clone())
            .collect();
        for key in &keys_to_remove {
            self.inner.pop(key);
            self.incremental.remove(key.as_str());
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

    // =========================================================================
    // Incremental state tracking
    // =========================================================================

    #[test]
    fn test_set_and_get_incremental() {
        let mut cache = SessionCache::default();
        let state = IncrementalState {
            byte_offset: 1024,
            metadata: SessionFileMetadata {
                custom_title: Some("My Session".to_string()),
                agent_name: None,
            },
        };
        cache.set_incremental("proj/sess1".to_string(), state);
        let retrieved = cache.get_incremental("proj/sess1").unwrap();
        assert_eq!(retrieved.byte_offset, 1024);
        assert_eq!(retrieved.metadata.custom_title.as_deref(), Some("My Session"));
    }

    #[test]
    fn test_get_incremental_missing() {
        let cache = SessionCache::default();
        assert!(cache.get_incremental("nonexistent").is_none());
    }

    #[test]
    fn test_remove_incremental() {
        let mut cache = SessionCache::default();
        cache.set_incremental(
            "proj/sess1".to_string(),
            IncrementalState {
                byte_offset: 512,
                metadata: SessionFileMetadata::default(),
            },
        );
        cache.remove_incremental("proj/sess1");
        assert!(cache.get_incremental("proj/sess1").is_none());
    }

    #[test]
    fn test_update_incremental_offset() {
        let mut cache = SessionCache::default();
        cache.set_incremental(
            "proj/sess1".to_string(),
            IncrementalState {
                byte_offset: 100,
                metadata: SessionFileMetadata::default(),
            },
        );
        cache.set_incremental(
            "proj/sess1".to_string(),
            IncrementalState {
                byte_offset: 500,
                metadata: SessionFileMetadata {
                    custom_title: Some("Updated".to_string()),
                    agent_name: None,
                },
            },
        );
        let state = cache.get_incremental("proj/sess1").unwrap();
        assert_eq!(state.byte_offset, 500);
        assert_eq!(state.metadata.custom_title.as_deref(), Some("Updated"));
    }

    #[test]
    fn test_invalidate_clears_incremental() {
        let mut cache = SessionCache::default();
        cache.insert("proj/sess1".to_string(), make_session());
        cache.set_incremental(
            "proj/sess1".to_string(),
            IncrementalState {
                byte_offset: 256,
                metadata: SessionFileMetadata::default(),
            },
        );
        cache.invalidate("proj/sess1");
        assert!(cache.get("proj/sess1").is_none());
        assert!(cache.get_incremental("proj/sess1").is_none());
    }

    #[test]
    fn test_invalidate_project_clears_incremental() {
        let mut cache = SessionCache::default();
        cache.insert("proj1/sess1".to_string(), make_session());
        cache.set_incremental(
            "proj1/sess1".to_string(),
            IncrementalState {
                byte_offset: 100,
                metadata: SessionFileMetadata::default(),
            },
        );
        cache.insert("proj2/sess1".to_string(), make_session());
        cache.set_incremental(
            "proj2/sess1".to_string(),
            IncrementalState {
                byte_offset: 200,
                metadata: SessionFileMetadata::default(),
            },
        );
        cache.invalidate_project("proj1");
        assert!(cache.get_incremental("proj1/sess1").is_none());
        assert!(cache.get_incremental("proj2/sess1").is_some());
    }
}
