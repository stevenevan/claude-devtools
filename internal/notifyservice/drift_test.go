package notifyservice

import (
	"path/filepath"
	"testing"

	"claude-devtools/internal/notifications"
)

func driftTestService(t *testing.T) *NotificationService {
	t.Helper()
	path := filepath.Join(t.TempDir(), "notifications.json")
	return &NotificationService{state: notifications.NewNotificationStateAt(path)}
}

func total(t *testing.T, s *NotificationService) int {
	t.Helper()
	res, err := s.NotificationsGet(nil)
	if err != nil {
		t.Fatal(err)
	}
	return res.TotalCount
}

// TestRaiseConfigDriftDedup asserts a config-drift alert stores once and a second
// same-(file, hourBucket) call is deduped by the synthetic ToolUseID (Metis 6),
// while a different hour bucket re-surfaces.
func TestRaiseConfigDriftDedup(t *testing.T) {
	s := driftTestService(t)

	if err := s.RaiseConfigDrift("/home/u/.claude/settings.json", 100, 3); err != nil {
		t.Fatal(err)
	}
	if got := total(t, s); got != 1 {
		t.Fatalf("first drift alert should store one, got %d", got)
	}

	// Same file + same hour bucket → deduped (no second notification).
	if err := s.RaiseConfigDrift("/home/u/.claude/settings.json", 100, 5); err != nil {
		t.Fatal(err)
	}
	if got := total(t, s); got != 1 {
		t.Fatalf("same-hour drift must dedup, got %d", got)
	}

	// Different hour bucket → a fresh alert.
	if err := s.RaiseConfigDrift("/home/u/.claude/settings.json", 101, 3); err != nil {
		t.Fatal(err)
	}
	if got := total(t, s); got != 2 {
		t.Fatalf("next-hour drift must re-surface, got %d", got)
	}
}

// TestRaiseConfigDriftDistinctFiles asserts two different files in the same hour
// are distinct alerts (the dedup key includes the file path).
func TestRaiseConfigDriftDistinctFiles(t *testing.T) {
	s := driftTestService(t)
	if err := s.RaiseConfigDrift("/home/u/.claude/settings.json", 100, 2); err != nil {
		t.Fatal(err)
	}
	if err := s.RaiseConfigDrift("/home/u/.claude.json", 100, 9); err != nil {
		t.Fatal(err)
	}
	if got := total(t, s); got != 2 {
		t.Fatalf("distinct files must not dedup against each other, got %d", got)
	}
}

// TestRaisePendingCleanupDedup asserts the pending-cleanup alert stores once and
// a same-set same-hour repeat is deduped.
func TestRaisePendingCleanupDedup(t *testing.T) {
	s := driftTestService(t)
	if err := s.RaisePendingCleanup([]string{"transcripts", "plans"}, 4096); err != nil {
		t.Fatal(err)
	}
	// Same set (order-independent) in the same hour → deduped.
	if err := s.RaisePendingCleanup([]string{"plans", "transcripts"}, 8192); err != nil {
		t.Fatal(err)
	}
	if got := total(t, s); got != 1 {
		t.Fatalf("same pending set in one hour must dedup, got %d", got)
	}
}
