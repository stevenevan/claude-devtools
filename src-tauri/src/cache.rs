/// LRU cache with TTL for parsed session data.

use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::time::{Duration, Instant};

use lru::LruCache;

use crate::parsing::session_parser::SessionFileMetadata;
use crate::types::domain::ParsedSession;

/// Hard memory budget for the whole session cache (sprint 63).
/// When `total_byte_estimate` exceeds this, oldest entries are evicted from
/// the LRU tail until the cache is back under budget. The bytes value is a
/// coarse heuristic (≈2 KB / message + parsed-session overhead); under-
/// estimation is preferred over double-counting so the budget acts as a
/// ceiling, not a floor.
pub const MAX_CACHE_BYTES: usize = 200 * 1024 * 1024;
const BYTES_PER_MESSAGE_ESTIMATE: usize = 2048;
const BASE_SESSION_BYTES: usize = 4096;

fn estimate_session_bytes(value: &ParsedSession) -> usize {
    BASE_SESSION_BYTES + value.messages.len() * BYTES_PER_MESSAGE_ESTIMATE
}

/// Cached entry with expiration tracking + coarse byte-budget hint.
struct CacheEntry {
    value: ParsedSession,
    inserted_at: Instant,
    byte_estimate: usize,
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
    /// Hit/miss/evict counters (sprint 46).
    pub hits: u64,
    pub misses: u64,
    pub evicts: u64,
    /// Sprint 63: byte-budget eviction counter (separate from LRU evicts).
    pub budget_evicts: u64,
    /// Sprint 63: total estimated bytes resident in the cache.
    total_byte_estimate: usize,
    /// Sprint 63: hard memory cap; insertions evict from the LRU tail.
    max_bytes: usize,
}

impl SessionCache {
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            inner: LruCache::new(NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(50).unwrap())),
            ttl,
            incremental: HashMap::new(),
            hits: 0,
            misses: 0,
            evicts: 0,
            budget_evicts: 0,
            total_byte_estimate: 0,
            max_bytes: MAX_CACHE_BYTES,
        }
    }

    pub fn total_byte_estimate(&self) -> usize {
        self.total_byte_estimate
    }

    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    pub fn set_max_bytes(&mut self, bytes: usize) {
        self.max_bytes = bytes.max(1024 * 1024);
        self.enforce_byte_budget();
    }

    fn enforce_byte_budget(&mut self) {
        while self.total_byte_estimate > self.max_bytes && self.inner.len() > 0 {
            if let Some((_, evicted)) = self.inner.pop_lru() {
                self.total_byte_estimate = self
                    .total_byte_estimate
                    .saturating_sub(evicted.byte_estimate);
                self.budget_evicts += 1;
            } else {
                break;
            }
        }
    }

    pub fn get(&mut self, key: &str) -> Option<&ParsedSession> {
        let expired = match self.inner.get(key) {
            Some(e) => e.inserted_at.elapsed() > self.ttl,
            None => {
                self.misses += 1;
                return None;
            }
        };
        if expired {
            if let Some(entry) = self.inner.pop(key) {
                self.total_byte_estimate = self
                    .total_byte_estimate
                    .saturating_sub(entry.byte_estimate);
            }
            self.evicts += 1;
            self.misses += 1;
            return None;
        }
        self.hits += 1;
        self.inner.get(key).map(|e| &e.value)
    }

    pub fn insert(&mut self, key: String, value: ParsedSession) {
        let was_full = self.inner.len() == self.inner.cap().get();
        let byte_estimate = estimate_session_bytes(&value);
        let prior = self.inner.pop(&key);
        if let Some(p) = &prior {
            self.total_byte_estimate = self.total_byte_estimate.saturating_sub(p.byte_estimate);
        }
        self.total_byte_estimate += byte_estimate;
        self.inner.put(
            key,
            CacheEntry {
                value,
                inserted_at: Instant::now(),
                byte_estimate,
            },
        );
        if was_full && prior.is_none() {
            self.evicts += 1;
        }
        self.enforce_byte_budget();
    }

    /// Sprint 46: hot-resize the cache. New capacity ≥ 1; entries beyond
    /// the new bound are evicted from the LRU tail.
    pub fn set_capacity(&mut self, capacity: usize) {
        let cap = NonZeroUsize::new(capacity.max(1)).unwrap();
        let prior = self.inner.len();
        self.inner.resize(cap);
        let new_len = self.inner.len();
        if prior > new_len {
            self.evicts += (prior - new_len) as u64;
        }
    }

    pub fn capacity(&self) -> usize {
        self.inner.cap().get()
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn clear(&mut self) {
        self.evicts += self.inner.len() as u64;
        self.inner.clear();
        self.incremental.clear();
        self.total_byte_estimate = 0;
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

    // Mirrors Go `SessionCache.InvalidateProject`: evicts every cached session
    // whose key is under the encoded project dir. The W13 maintenance trash path
    // is the first production caller (`evict_trashed_projects`).
    pub fn invalidate_project(&mut self, project_id: &str) {
        let prefix = format!("{project_id}/");
        let keys_to_remove: Vec<String> = self
            .inner
            .iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .map(|(k, _)| k.clone())
            .collect();
        for key in &keys_to_remove {
            if let Some(entry) = self.inner.pop(key) {
                self.total_byte_estimate = self
                    .total_byte_estimate
                    .saturating_sub(entry.byte_estimate);
            }
            self.incremental.remove(key.as_str());
        }
    }
}

#[cfg(test)]
impl SessionCache {
    pub fn invalidate(&mut self, key: &str) {
        if let Some(entry) = self.inner.pop(key) {
            self.total_byte_estimate = self
                .total_byte_estimate
                .saturating_sub(entry.byte_estimate);
        }
        self.incremental.remove(key);
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

    fn session_with_messages(n: usize) -> ParsedSession {
        let mut s = make_session();
        s.messages = (0..n)
            .map(|i| crate::types::messages::ParsedMessage {
                uuid: format!("u{i}"),
                parent_uuid: None,
                message_type: "user".to_string(),
                timestamp: "2024-01-01T00:00:00Z".to_string(),
                role: Some("user".to_string()),
                content: crate::types::messages::ParsedMessageContent::Text("hi".to_string()),
                usage: None,
                model: None,
                cwd: None,
                git_branch: None,
                agent_id: None,
                is_sidechain: false,
                is_meta: false,
                user_type: None,
                tool_calls: vec![],
                tool_results: vec![],
                source_tool_use_id: None,
                source_tool_assistant_uuid: None,
                tool_use_result: None,
                is_compact_summary: None,
                request_id: None,
                subtype: None,
                event_data: None,
            })
            .collect();
        s
    }

    #[test]
    fn test_byte_estimate_increments_on_insert() {
        let mut cache = SessionCache::default();
        let before = cache.total_byte_estimate();
        cache.insert("proj/s1".to_string(), session_with_messages(10));
        assert!(cache.total_byte_estimate() > before);
    }

    #[test]
    fn test_byte_budget_evicts_lru_tail() {
        let mut cache = SessionCache::default();
        // 1 MB cap: forces eviction quickly.
        cache.set_max_bytes(1024 * 1024);

        // Each session ≈ 100 messages * 2KB = 200KB + base. Insert 10 to overflow.
        for i in 0..10 {
            cache.insert(format!("p/s{i}"), session_with_messages(100));
        }
        assert!(
            cache.total_byte_estimate() <= cache.max_bytes(),
            "total bytes ({}) must stay under cap ({})",
            cache.total_byte_estimate(),
            cache.max_bytes()
        );
        assert!(
            cache.budget_evicts > 0,
            "budget_evicts counter must record evictions"
        );
        // Earliest inserts should have been evicted (LRU tail).
        assert!(cache.get("p/s0").is_none());
    }

    #[test]
    fn test_set_max_bytes_re_enforces_immediately() {
        let mut cache = SessionCache::default();
        // 10 sessions * 500 msgs * 2KB ≈ 10 MB total to clearly exceed clamp floor.
        for i in 0..10 {
            cache.insert(format!("p/s{i}"), session_with_messages(500));
        }
        let before_total = cache.total_byte_estimate();
        let before_evicts = cache.budget_evicts;
        cache.set_max_bytes(1024 * 1024); // 1 MB cap (the minimum floor)
        assert!(cache.budget_evicts > before_evicts);
        assert!(cache.total_byte_estimate() < before_total);
        assert!(cache.total_byte_estimate() <= cache.max_bytes());
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
