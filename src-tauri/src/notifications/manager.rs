//! `NotificationState` — the persisted notification store ported from
//! `internal/notifications/manager.go`. Owns persistence (atomic temp+rename),
//! the W13 auto-prune policy (retention days + max count), hour-bucket
//! throttling, and CRUD.
//!
//! Go exposes external `Lock()`/`Unlock()`; the Rust port holds an interior
//! `Mutex<Inner>` and locks inside every method (service calls are
//! single-threaded per operation).

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::files::json_util::to_go_json_pretty;

use super::types::{
    DetectedError, GetNotificationsOptions, GetNotificationsResult, NotificationUpdatedPayload,
    StoredNotification,
};

const THROTTLE_MS: f64 = 5000.0;

// W13 auto-prune defaults (overridden from config at startup via `set_policy`).
const DEFAULT_RETENTION_DAYS: i64 = 30;
const DEFAULT_MAX_COUNT: i64 = 200;
const MS_PER_DAY: f64 = 86_400_000.0;

/// Current time as epoch milliseconds (mirrors `tokens.go:NowMS`).
fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// The locked interior — mirrors the fields of Go's `NotificationState`.
struct Inner {
    notifications: Vec<StoredNotification>,
    notification_path: PathBuf,
    throttle_map: HashMap<String, f64>,
    retention_days: i64,
    max_count: i64,
}

impl Inner {
    // ── Persistence ────────────────────────────────────────────────────────

    fn load_notifications(&mut self) {
        if !self.notification_path.exists() {
            return;
        }
        match std::fs::read_to_string(&self.notification_path) {
            Ok(data) => match serde_json::from_str::<Vec<StoredNotification>>(&data) {
                Ok(parsed) => self.notifications = parsed,
                Err(e) => {
                    eprintln!("notifications: invalid stored format — starting fresh: {e}");
                    self.notifications = Vec::new();
                }
            },
            Err(e) => eprintln!("notifications: failed to load: {e}"),
        }
    }

    fn save_notifications(&self) {
        if let Some(parent) = self.notification_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                eprintln!("notifications: mkdir failed: {e}");
                return;
            }
        }
        let data = match to_go_json_pretty(&self.notifications) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("notifications: marshal failed: {e}");
                return;
            }
        };
        // Atomic write: temp then rename. `path + ".tmp"` (byte-identical to Go).
        let mut tmp: OsString = self.notification_path.clone().into_os_string();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        if let Err(e) = std::fs::write(&tmp, &data) {
            eprintln!("notifications: write tmp failed: {e}");
            return;
        }
        if let Err(e) = std::fs::rename(&tmp, &self.notification_path) {
            let _ = std::fs::remove_file(&tmp);
            eprintln!("notifications: rename failed: {e}");
        }
    }

    /// Enforces the W13 age + count policy. Age drop removes entries older than
    /// `retention_days`; the count cap removes the oldest READ entries first so
    /// unread notifications outlive read ones under count pressure. Runs on load
    /// and on append.
    fn prune_notifications(&mut self) {
        let mut changed = false;

        if self.retention_days > 0 {
            let cutoff = now_ms() - (self.retention_days as f64) * MS_PER_DAY;
            let before = self.notifications.len();
            self.notifications.retain(|n| n.created_at >= cutoff);
            if self.notifications.len() != before {
                changed = true;
            }
        }

        if self.max_count > 0 && self.notifications.len() > self.max_count as usize {
            let max = self.max_count as usize;
            let overflow = self.notifications.len() - max;
            // Oldest-first, so the first removable entries are the oldest.
            self.notifications.sort_by(|a, b| {
                a.created_at
                    .partial_cmp(&b.created_at)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let mut remove = vec![false; self.notifications.len()];
            let mut removed = 0;
            // Drop oldest READ first.
            for i in 0..self.notifications.len() {
                if removed >= overflow {
                    break;
                }
                if self.notifications[i].is_read {
                    remove[i] = true;
                    removed += 1;
                }
            }
            // Then oldest unread if still over cap.
            for i in 0..self.notifications.len() {
                if removed >= overflow {
                    break;
                }
                if !remove[i] {
                    remove[i] = true;
                    removed += 1;
                }
            }
            let mut kept = Vec::with_capacity(max);
            for (i, n) in self.notifications.drain(..).enumerate() {
                if !remove[i] {
                    kept.push(n);
                }
            }
            self.notifications = kept;
            changed = true;
        }

        if changed {
            // Newest-first.
            self.notifications.sort_by(|a, b| {
                b.created_at
                    .partial_cmp(&a.created_at)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            self.save_notifications();
        }
    }

    // ── Throttling ─────────────────────────────────────────────────────────

    fn is_throttled(&mut self, error: &DetectedError) -> bool {
        let hash = format!("{}:{}", error.project_id, error.message);
        let now = now_ms();

        if let Some(&last) = self.throttle_map.get(&hash) {
            if now - last < THROTTLE_MS {
                return true;
            }
        }
        self.throttle_map.insert(hash, now);

        // Clean up stale entries (older than 2× throttle window).
        let threshold = now - THROTTLE_MS * 2.0;
        self.throttle_map.retain(|_, ts| *ts >= threshold);
        false
    }

    fn unread_count(&self) -> usize {
        self.notifications.iter().filter(|n| !n.is_read).count()
    }
}

/// The persisted notification store. Mirrors `manager.go:NotificationState`.
pub struct NotificationState {
    inner: Mutex<Inner>,
}

impl NotificationState {
    /// Loads the persisted store from `$HOME/.claude/claude-devtools-notifications.json`
    /// (byte-identical to `manager.go:NewNotificationState`; `/tmp` home fallback).
    pub fn new() -> Self {
        let path = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".claude")
            .join("claude-devtools-notifications.json");
        Self::new_at(path)
    }

    /// Constructs the store with an explicit persistence path (mirrors
    /// `NewNotificationStateAt`; used by tests to isolate on-disk state).
    pub fn new_at(path: impl Into<PathBuf>) -> Self {
        let mut inner = Inner {
            notifications: Vec::new(),
            notification_path: path.into(),
            throttle_map: HashMap::new(),
            retention_days: DEFAULT_RETENTION_DAYS,
            max_count: DEFAULT_MAX_COUNT,
        };
        inner.load_notifications();
        inner.prune_notifications();
        Self {
            inner: Mutex::new(inner),
        }
    }

    /// Updates the auto-prune bounds and re-prunes immediately.
    pub fn set_policy(&self, retention_days: i64, max_count: i64) {
        let mut inner = self.inner.lock().unwrap();
        inner.retention_days = retention_days;
        inner.max_count = max_count;
        inner.prune_notifications();
    }

    /// Decides whether a native OS notification should fire.
    pub fn should_show_native(
        &self,
        error: &DetectedError,
        enabled: bool,
        snoozed_until: Option<f64>,
        ignored_regex: &[String],
    ) -> bool {
        if !enabled {
            return false;
        }
        if let Some(until) = snoozed_until {
            if now_ms() < until {
                return false;
            }
        }
        // Case-insensitive match, invalid pattern ⇒ no match
        // (mirrors `trigger_matcher.go:MatchesPattern`).
        for pattern in ignored_regex {
            if let Ok(re) = regex::Regex::new(&format!("(?i){pattern}")) {
                if re.is_match(&error.message) {
                    return false;
                }
            }
        }
        !self.inner.lock().unwrap().is_throttled(error)
    }

    /// Stores a new error, deduplicating by `tool_use_id`. Returns the stored
    /// notification, or `None` if deduplicated.
    pub fn add_error(&self, error: DetectedError) -> Option<StoredNotification> {
        let mut inner = self.inner.lock().unwrap();

        if let Some(tool_use_id) = error.tool_use_id.as_deref() {
            if let Some(idx) = inner
                .notifications
                .iter()
                .position(|n| n.error.tool_use_id.as_deref() == Some(tool_use_id))
            {
                // Replace if we now have subagent annotation and the previous didn't.
                if inner.notifications[idx].error.subagent_id.is_none()
                    && error.subagent_id.is_some()
                {
                    inner.notifications.remove(idx);
                } else {
                    return None;
                }
            }
        }

        let stored = StoredNotification {
            error,
            is_read: false,
            created_at: now_ms(),
        };
        // Prepend (newest first).
        inner.notifications.insert(0, stored.clone());
        inner.prune_notifications();
        inner.save_notifications();
        Some(stored)
    }

    /// Returns a paginated result (default limit 20, offset 0).
    pub fn get_notifications(
        &self,
        options: Option<GetNotificationsOptions>,
    ) -> GetNotificationsResult {
        let inner = self.inner.lock().unwrap();
        let limit = options.as_ref().and_then(|o| o.limit).unwrap_or(20).max(0) as usize;
        let offset = options.as_ref().and_then(|o| o.offset).unwrap_or(0).max(0) as usize;

        let total = inner.notifications.len();
        let end = (offset + limit).min(total);
        let notifications = if offset < total {
            inner.notifications[offset..end].to_vec()
        } else {
            Vec::new()
        };

        GetNotificationsResult {
            notifications,
            total: total as i64,
            total_count: total as i64,
            unread_count: inner.unread_count() as i64,
            has_more: end < total,
        }
    }

    /// Marks a notification as read, returning true if found.
    pub fn mark_read(&self, id: &str) -> bool {
        let mut inner = self.inner.lock().unwrap();
        if let Some(n) = inner.notifications.iter_mut().find(|n| n.error.id == id) {
            if !n.is_read {
                n.is_read = true;
                inner.save_notifications();
            }
            true
        } else {
            false
        }
    }

    /// Marks all notifications as read.
    pub fn mark_all_read(&self) -> bool {
        let mut inner = self.inner.lock().unwrap();
        let mut changed = false;
        for n in &mut inner.notifications {
            if !n.is_read {
                n.is_read = true;
                changed = true;
            }
        }
        if changed {
            inner.save_notifications();
        }
        true
    }

    /// Removes a notification by ID, returning true if one was removed.
    pub fn delete_notification(&self, id: &str) -> bool {
        let mut inner = self.inner.lock().unwrap();
        let before = inner.notifications.len();
        inner.notifications.retain(|n| n.error.id != id);
        if inner.notifications.len() < before {
            inner.save_notifications();
            true
        } else {
            false
        }
    }

    /// Removes all notifications.
    pub fn clear_all(&self) -> bool {
        let mut inner = self.inner.lock().unwrap();
        inner.notifications.clear();
        inner.save_notifications();
        true
    }

    /// Returns the count of unread notifications.
    pub fn unread_count(&self) -> usize {
        self.inner.lock().unwrap().unread_count()
    }

    /// Builds the payload for `notification:updated` events.
    pub fn updated_payload(&self) -> NotificationUpdatedPayload {
        let inner = self.inner.lock().unwrap();
        NotificationUpdatedPayload {
            total: inner.notifications.len() as i64,
            unread_count: inner.unread_count() as i64,
        }
    }
}

impl Default for NotificationState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod manager_tests;
