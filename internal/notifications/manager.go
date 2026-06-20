// manager.go ports src-tauri/src/notifications/manager.rs.
// NotificationState owns the persisted notification store.
// Persistence is atomic: write to .tmp then os.Rename.
package notifications

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

const (
	maxNotifications = 100
	throttleMS       = 5000.0
)

// NotificationState mirrors manager.rs NotificationState.
// All methods are exported; callers must hold mu externally (the service wraps
// this behind its own sync.Mutex).
type NotificationState struct {
	mu               sync.Mutex
	notifications    []StoredNotification
	notificationPath string
	throttleMap      map[string]float64
	initialized      bool
}

// NewNotificationState constructs and initialises the state by loading from disk.
// Mirrors manager.rs NotificationState::new.
func NewNotificationState() *NotificationState {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "/tmp"
	}
	path := filepath.Join(home, ".claude", "claude-devtools-notifications.json")
	return newNotificationStateAt(path)
}

// NewNotificationStateAt constructs state using a custom persistence path.
// Exported so tests can isolate state from the real on-disk store.
func NewNotificationStateAt(path string) *NotificationState {
	return newNotificationStateAt(path)
}

// newNotificationStateAt is the internal constructor that accepts an explicit path.
func newNotificationStateAt(path string) *NotificationState {
	s := &NotificationState{
		notificationPath: path,
		throttleMap:      make(map[string]float64),
	}
	s.initialize()
	return s
}

func (s *NotificationState) initialize() {
	if s.initialized {
		return
	}
	s.loadNotifications()
	s.pruneNotifications()
	s.initialized = true
}

// ─── Persistence ──────────────────────────────────────────────────────────────

func (s *NotificationState) loadNotifications() {
	data, err := os.ReadFile(s.notificationPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("notifications: failed to load: %v", err)
		}
		return
	}
	var parsed []StoredNotification
	if err := json.Unmarshal(data, &parsed); err != nil {
		log.Printf("notifications: invalid stored format — starting fresh: %v", err)
		s.notifications = []StoredNotification{}
		return
	}
	s.notifications = parsed
}

func (s *NotificationState) saveNotifications() {
	if err := os.MkdirAll(filepath.Dir(s.notificationPath), 0o755); err != nil {
		log.Printf("notifications: mkdir failed: %v", err)
		return
	}
	data, err := json.MarshalIndent(s.notifications, "", "  ")
	if err != nil {
		log.Printf("notifications: marshal failed: %v", err)
		return
	}
	tmp := s.notificationPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		log.Printf("notifications: write tmp failed: %v", err)
		return
	}
	if err := os.Rename(tmp, s.notificationPath); err != nil {
		_ = os.Remove(tmp)
		log.Printf("notifications: rename failed: %v", err)
	}
}

func (s *NotificationState) pruneNotifications() {
	if len(s.notifications) <= maxNotifications {
		return
	}
	// Sort newest first by createdAt then truncate.
	sort.Slice(s.notifications, func(i, j int) bool {
		return s.notifications[i].CreatedAt > s.notifications[j].CreatedAt
	})
	s.notifications = s.notifications[:maxNotifications]
	s.saveNotifications()
}

// ─── Throttling ───────────────────────────────────────────────────────────────

func (s *NotificationState) isThrottled(error *DetectedError) bool {
	hash := error.ProjectID + ":" + error.Message
	now := NowMS()

	if last, ok := s.throttleMap[hash]; ok {
		if now-last < throttleMS {
			return true
		}
	}
	s.throttleMap[hash] = now

	// Clean up stale entries (older than 2× throttle window).
	threshold := now - throttleMS*2
	for k, ts := range s.throttleMap {
		if ts < threshold {
			delete(s.throttleMap, k)
		}
	}
	return false
}

// ShouldShowNative decides whether a native OS notification should fire.
// Mirrors manager.rs::should_show_native.
func (s *NotificationState) ShouldShowNative(
	error *DetectedError,
	enabled bool,
	snoozedUntil *float64,
	ignoredRegex []string,
) bool {
	if !enabled {
		return false
	}
	if snoozedUntil != nil && NowMS() < *snoozedUntil {
		return false
	}
	for _, pattern := range ignoredRegex {
		if MatchesPattern(error.Message, pattern) {
			return false
		}
	}
	return !s.isThrottled(error)
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

// AddError stores a new error notification, deduplicating by tool_use_id.
// Returns the stored notification, or nil if deduplicated.
// Mirrors manager.rs::add_error.
func (s *NotificationState) AddError(error DetectedError) *StoredNotification {
	if error.ToolUseID != nil {
		for i, n := range s.notifications {
			if n.ToolUseID != nil && *n.ToolUseID == *error.ToolUseID {
				// Replace if we now have subagent annotation and previous didn't.
				if n.SubagentID == nil && error.SubagentID != nil {
					s.notifications = append(s.notifications[:i], s.notifications[i+1:]...)
					break
				}
				return nil
			}
		}
	}

	stored := StoredNotification{
		DetectedError: error,
		IsRead:        false,
		CreatedAt:     NowMS(),
	}
	// Prepend (newest first).
	s.notifications = append([]StoredNotification{stored}, s.notifications...)
	s.pruneNotifications()
	s.saveNotifications()
	return &stored
}

// GetNotifications returns a paginated result.
// Mirrors manager.rs::get_notifications.
func (s *NotificationState) GetNotifications(options *GetNotificationsOptions) GetNotificationsResult {
	limit := 20
	offset := 0
	if options != nil {
		if options.Limit != nil {
			limit = *options.Limit
		}
		if options.Offset != nil {
			offset = *options.Offset
		}
	}

	total := len(s.notifications)
	end := offset + limit
	if end > total {
		end = total
	}

	var page []StoredNotification
	if offset < total {
		page = append([]StoredNotification{}, s.notifications[offset:end]...)
	} else {
		page = []StoredNotification{}
	}

	return GetNotificationsResult{
		Notifications: page,
		Total:         total,
		TotalCount:    total,
		UnreadCount:   s.UnreadCount(),
		HasMore:       end < total,
	}
}

// MarkRead marks a notification as read, returning true if found.
// Mirrors manager.rs::mark_read.
func (s *NotificationState) MarkRead(id string) bool {
	for i := range s.notifications {
		if s.notifications[i].ID == id {
			if !s.notifications[i].IsRead {
				s.notifications[i].IsRead = true
				s.saveNotifications()
			}
			return true
		}
	}
	return false
}

// MarkAllRead marks all notifications as read.
// Mirrors manager.rs::mark_all_read.
func (s *NotificationState) MarkAllRead() bool {
	changed := false
	for i := range s.notifications {
		if !s.notifications[i].IsRead {
			s.notifications[i].IsRead = true
			changed = true
		}
	}
	if changed {
		s.saveNotifications()
	}
	return true
}

// DeleteNotification removes a notification by ID.
// Mirrors manager.rs::delete_notification.
func (s *NotificationState) DeleteNotification(id string) bool {
	before := len(s.notifications)
	next := s.notifications[:0]
	for _, n := range s.notifications {
		if n.ID != id {
			next = append(next, n)
		}
	}
	s.notifications = next
	if len(s.notifications) < before {
		s.saveNotifications()
		return true
	}
	return false
}

// ClearAll removes all notifications.
// Mirrors manager.rs::clear_all.
func (s *NotificationState) ClearAll() bool {
	s.notifications = []StoredNotification{}
	s.saveNotifications()
	return true
}

// UnreadCount returns the count of unread notifications.
// Mirrors manager.rs::unread_count.
func (s *NotificationState) UnreadCount() int {
	n := 0
	for i := range s.notifications {
		if !s.notifications[i].IsRead {
			n++
		}
	}
	return n
}

// UpdatedPayload builds the payload for notification:updated events.
// Mirrors manager.rs::updated_payload.
func (s *NotificationState) UpdatedPayload() NotificationUpdatedPayload {
	return NotificationUpdatedPayload{
		Total:       len(s.notifications),
		UnreadCount: s.UnreadCount(),
	}
}

// Lock / Unlock expose the internal mutex so the service can hold it across
// compound operations (add + emit).
func (s *NotificationState) Lock()   { s.mu.Lock() }
func (s *NotificationState) Unlock() { s.mu.Unlock() }
