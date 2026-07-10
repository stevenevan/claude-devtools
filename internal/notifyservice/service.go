// Package notifyservice wires internal/notifications into the Wails service layer.
// The service owns the NotificationState and exposes the 8 frontend commands.
// Wails event emission is app-nil-guarded so unit tests pass without a running app.
package notifyservice

import (
	"context"

	"github.com/gen2brain/beeep"
	"github.com/wailsapp/wails/v3/pkg/application"

	"claude-devtools/internal/config"
	"claude-devtools/internal/notifications"
	"claude-devtools/internal/parsing"
)

// NotificationService matches triggers and emits notification:* events.
type NotificationService struct {
	ctx    context.Context
	state  *notifications.NotificationState
	config *config.ConfigState
}

func (s *NotificationService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx
	s.state = notifications.NewNotificationState()
	s.config = &config.ConfigState{}
	// Apply the persisted W13 auto-prune policy over the constructor defaults.
	nc := s.config.GetConfig().Notifications
	s.state.Lock()
	s.state.SetPolicy(nc.RetentionDays, nc.MaxCount)
	s.state.Unlock()
	return nil
}

// SetNotificationPolicy persists the W13 auto-prune bounds and applies them to
// the live store immediately. Returns the clamped [retentionDays, maxCount].
func (s *NotificationService) SetNotificationPolicy(retentionDays, maxCount int) ([]int, error) {
	rd, mc, err := s.config.SetNotificationPolicy(retentionDays, maxCount)
	if err != nil {
		return nil, err
	}
	s.state.Lock()
	s.state.SetPolicy(rd, mc)
	s.state.Unlock()
	return []int{rd, mc}, nil
}

func (s *NotificationService) ServiceShutdown() error { return nil }

// GetState returns whether the notification engine is active.
func (s *NotificationService) GetState() (bool, error) { return true, nil }

// ─── emit helper ─────────────────────────────────────────────────────────────

// emitEvent emits a Wails application event, guarded against a nil app.
func emitEvent(name string, payload any) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit(name, payload)
}

// ─── 8 commands ───────────────────────────────────────────────────────────────

// NotificationsGet returns a paginated list of notifications.
// Mirrors notifications/commands.rs::notifications_get.
func (s *NotificationService) NotificationsGet(
	options *notifications.GetNotificationsOptions,
) (notifications.GetNotificationsResult, error) {
	s.state.Lock()
	defer s.state.Unlock()
	return s.state.GetNotifications(options), nil
}

// NotificationsMarkRead marks a single notification as read.
// Mirrors notifications/commands.rs::notifications_mark_read.
func (s *NotificationService) NotificationsMarkRead(id string) (bool, error) {
	s.state.Lock()
	result := s.state.MarkRead(id)
	payload := s.state.UpdatedPayload()
	s.state.Unlock()

	if result {
		emitEvent("notification:updated", payload)
	}
	return result, nil
}

// NotificationsMarkAllRead marks all notifications as read.
// Mirrors notifications/commands.rs::notifications_mark_all_read.
func (s *NotificationService) NotificationsMarkAllRead() (bool, error) {
	s.state.Lock()
	result := s.state.MarkAllRead()
	payload := s.state.UpdatedPayload()
	s.state.Unlock()

	emitEvent("notification:updated", payload)
	return result, nil
}

// NotificationsDelete removes a notification by ID.
// Mirrors notifications/commands.rs::notifications_delete.
func (s *NotificationService) NotificationsDelete(id string) (bool, error) {
	s.state.Lock()
	result := s.state.DeleteNotification(id)
	payload := s.state.UpdatedPayload()
	s.state.Unlock()

	if result {
		emitEvent("notification:updated", payload)
	}
	return result, nil
}

// NotificationsClear removes all notifications.
// Mirrors notifications/commands.rs::notifications_clear.
func (s *NotificationService) NotificationsClear() (bool, error) {
	s.state.Lock()
	result := s.state.ClearAll()
	payload := s.state.UpdatedPayload()
	s.state.Unlock()

	emitEvent("notification:updated", payload)
	return result, nil
}

// NotificationsGetUnreadCount returns the unread notification count.
// Mirrors notifications/commands.rs::notifications_get_unread_count.
func (s *NotificationService) NotificationsGetUnreadCount() (int, error) {
	s.state.Lock()
	defer s.state.Unlock()
	return s.state.UnreadCount(), nil
}

// NotificationsTestTrigger runs a trigger against historical sessions.
// Mirrors notifications/commands.rs::notifications_test_trigger.
func (s *NotificationService) NotificationsTestTrigger(
	trigger config.NotificationTrigger,
	limit *int,
) (notifications.TriggerTestResult, error) {
	return notifications.TestTrigger(&trigger, limit), nil
}

// WebhookTestSend validates and fires a test webhook delivery.
// Mirrors notifications/webhook.rs::webhook_test_send.
func (s *NotificationService) WebhookTestSend(endpoint notifications.WebhookEndpoint) error {
	ctx := &notifications.WebhookContext{
		SessionID: "test-session",
		Tool:      "Bash",
		Cost:      0.0123,
		Summary:   "Test webhook from claude-devtools",
	}
	transport := notifications.NewHTTPTransport()
	if err := notifications.DispatchWebhook(transport, &endpoint, ctx); err != nil {
		return err
	}
	return nil
}

// ─── Detection + native notification ─────────────────────────────────────────

// DetectAndNotify runs error detection for a session and stores/emits results.
// Called from the file watcher when a JSONL file changes.
// Mirrors notifications/commands.rs::detect_and_notify.
func (s *NotificationService) DetectAndNotify(
	filePath, projectID, sessionID string,
	cfg *config.AppConfig,
) error {
	var triggers []config.NotificationTrigger
	for _, t := range cfg.Notifications.Triggers {
		if t.Enabled {
			triggers = append(triggers, t)
		}
	}
	if len(triggers) == 0 {
		return nil
	}

	messages, _, err := parsing.ParseJSONLFile(filePath)
	if err != nil {
		return err
	}

	errors := notifications.DetectErrors(messages, sessionID, projectID, filePath, triggers)
	if len(errors) == 0 {
		return nil
	}

	notifEnabled := cfg.Notifications.Enabled
	snoozedUntil := cfg.Notifications.SnoozedUntil
	ignoredRegex := cfg.Notifications.IgnoredRegex

	s.state.Lock()
	defer s.state.Unlock()

	for _, e := range errors {
		shouldNative := s.state.ShouldShowNative(&e, notifEnabled, snoozedUntil, ignoredRegex)
		stored := s.state.AddError(e)
		if stored != nil {
			emitEvent("notification:new", stored)
			emitEvent("notification:updated", s.state.UpdatedPayload())
			if shouldNative {
				showNativeNotification(stored)
			}
		}
	}
	return nil
}

// showNativeNotification fires a desktop toast via beeep.
// Mirrors notifications/commands.rs::show_native_notification.
func showNativeNotification(stored *notifications.StoredNotification) {
	body := stored.Message
	if len(body) > 200 {
		body = body[:200]
	}
	// beeep.Notify(title, body, iconPath) — icon path left empty.
	_ = beeep.Notify("Claude Code Error", body, "")
}
