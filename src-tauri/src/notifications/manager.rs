/// NotificationState — manages notification persistence, CRUD, dedup, and throttling.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::types::{
    DetectedError, GetNotificationsOptions, GetNotificationsResult, NotificationUpdatedPayload,
    StoredNotification,
};

// =============================================================================
// Constants
// =============================================================================

const MAX_NOTIFICATIONS: usize = 100;
const THROTTLE_MS: f64 = 5000.0;

// =============================================================================
// NotificationState
// =============================================================================

pub struct NotificationState {
    notifications: Vec<StoredNotification>,
    notification_path: PathBuf,
    throttle_map: HashMap<String, f64>,
    initialized: bool,
}

impl NotificationState {
    pub fn new() -> Self {
        let notification_path = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".claude")
            .join("claude-devtools-notifications.json");

        let mut state = Self {
            notifications: Vec::new(),
            notification_path,
            throttle_map: HashMap::new(),
            initialized: false,
        };
        state.initialize();
        state
    }

    fn initialize(&mut self) {
        if self.initialized {
            return;
        }
        self.load_notifications();
        self.prune_notifications();
        self.initialized = true;
    }

    // =========================================================================
    // Persistence
    // =========================================================================

    fn load_notifications(&mut self) {
        if !self.notification_path.exists() {
            return;
        }
        match std::fs::read_to_string(&self.notification_path) {
            Ok(data) => {
                match serde_json::from_str::<Vec<StoredNotification>>(&data) {
                    Ok(parsed) => self.notifications = parsed,
                    Err(e) => {
                        eprintln!(
                            "[notifications] Invalid format, starting fresh: {e}"
                        );
                        self.notifications = Vec::new();
                    }
                }
            }
            Err(e) => {
                eprintln!("[notifications] Error loading: {e}");
            }
        }
    }

    fn save_notifications(&self) {
        // Ensure parent directory exists
        if let Some(parent) = self.notification_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // Atomic write: write to .tmp then rename
        let tmp_path = self.notification_path.with_extension("json.tmp");
        match serde_json::to_string_pretty(&self.notifications) {
            Ok(json) => {
                if let Err(e) = std::fs::write(&tmp_path, &json) {
                    eprintln!("[notifications] Error writing tmp: {e}");
                    return;
                }
                if let Err(e) = std::fs::rename(&tmp_path, &self.notification_path) {
                    eprintln!("[notifications] Error renaming: {e}");
                }
            }
            Err(e) => {
                eprintln!("[notifications] Error serializing: {e}");
            }
        }
    }

    fn prune_notifications(&mut self) {
        if self.notifications.len() > MAX_NOTIFICATIONS {
            // Sort newest first
            self.notifications
                .sort_by(|a, b| b.created_at.partial_cmp(&a.created_at).unwrap_or(std::cmp::Ordering::Equal));
            self.notifications.truncate(MAX_NOTIFICATIONS);
            self.save_notifications();
        }
    }

    // =========================================================================
    // Throttling
    // =========================================================================

    fn now_ms() -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0)
    }

    fn is_throttled(&mut self, error: &DetectedError) -> bool {
        let hash = format!("{}:{}", error.project_id, error.message);
        let now = Self::now_ms();

        if let Some(&last_seen) = self.throttle_map.get(&hash) {
            if now - last_seen < THROTTLE_MS {
                return true;
            }
        }

        self.throttle_map.insert(hash, now);

        // Cleanup old entries
        let threshold = now - THROTTLE_MS * 2.0;
        self.throttle_map.retain(|_, ts| *ts >= threshold);

        false
    }

    /// Returns true if native notification should be shown for this error.
    pub fn should_show_native(
        &mut self,
        error: &DetectedError,
        enabled: bool,
        snoozed_until: Option<f64>,
        ignored_regex: &[String],
    ) -> bool {
        if !enabled {
            return false;
        }

        // Check snooze
        if let Some(until) = snoozed_until {
            if Self::now_ms() < until {
                return false;
            }
        }

        // Check ignored regex
        for pattern in ignored_regex {
            if let Ok(re) = regex::Regex::new(&format!("(?i){pattern}")) {
                if re.is_match(&error.message) {
                    return false;
                }
            }
        }

        // Check throttle
        if self.is_throttled(error) {
            return false;
        }

        true
    }

    // =========================================================================
    // CRUD Operations
    // =========================================================================

    /// Add an error, returning the stored notification (or None if deduplicated).
    pub fn add_error(&mut self, error: DetectedError) -> Option<StoredNotification> {
        // Deduplicate by toolUseId: prefer subagent-annotated version
        if let Some(ref tool_use_id) = error.tool_use_id {
            if let Some(idx) = self
                .notifications
                .iter()
                .position(|n| n.error.tool_use_id.as_deref() == Some(tool_use_id))
            {
                if self.notifications[idx].error.subagent_id.is_none()
                    && error.subagent_id.is_some()
                {
                    // Replace with subagent-annotated version
                    self.notifications.remove(idx);
                } else {
                    // Already have equal or better version
                    return None;
                }
            }
        }

        let notification = StoredNotification {
            error,
            is_read: false,
            created_at: Self::now_ms(),
        };

        // Prepend (newest first)
        self.notifications.insert(0, notification.clone());
        self.prune_notifications();
        self.save_notifications();

        Some(notification)
    }

    /// Get paginated notifications.
    pub fn get_notifications(
        &self,
        options: Option<GetNotificationsOptions>,
    ) -> GetNotificationsResult {
        let limit = options
            .as_ref()
            .and_then(|o| o.limit)
            .unwrap_or(20);
        let offset = options
            .as_ref()
            .and_then(|o| o.offset)
            .unwrap_or(0);

        let total = self.notifications.len();
        let end = (offset + limit).min(total);
        let notifications = if offset < total {
            self.notifications[offset..end].to_vec()
        } else {
            vec![]
        };
        let has_more = end < total;

        GetNotificationsResult {
            notifications,
            total,
            total_count: total,
            unread_count: self.unread_count(),
            has_more,
        }
    }

    /// Mark a notification as read.
    pub fn mark_read(&mut self, id: &str) -> bool {
        if let Some(n) = self.notifications.iter_mut().find(|n| n.error.id == id) {
            if !n.is_read {
                n.is_read = true;
                self.save_notifications();
            }
            true
        } else {
            false
        }
    }

    /// Mark all notifications as read.
    pub fn mark_all_read(&mut self) -> bool {
        let mut changed = false;
        for n in &mut self.notifications {
            if !n.is_read {
                n.is_read = true;
                changed = true;
            }
        }
        if changed {
            self.save_notifications();
        }
        true
    }

    /// Delete a notification by ID.
    pub fn delete_notification(&mut self, id: &str) -> bool {
        let before = self.notifications.len();
        self.notifications.retain(|n| n.error.id != id);
        if self.notifications.len() < before {
            self.save_notifications();
            true
        } else {
            false
        }
    }

    /// Clear all notifications.
    pub fn clear_all(&mut self) -> bool {
        self.notifications.clear();
        self.save_notifications();
        true
    }

    /// Get unread count.
    pub fn unread_count(&self) -> usize {
        self.notifications.iter().filter(|n| !n.is_read).count()
    }

    /// Build an updated-payload for Tauri events.
    pub fn updated_payload(&self) -> NotificationUpdatedPayload {
        NotificationUpdatedPayload {
            total: self.notifications.len(),
            unread_count: self.unread_count(),
        }
    }
}
