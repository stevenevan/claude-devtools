package notifications

import (
	"path/filepath"
	"testing"
)

func TestPruneAgeDrop(t *testing.T) {
	s := NewNotificationStateAt(filepath.Join(t.TempDir(), "n.json"))
	now := NowMS()
	s.notifications = []StoredNotification{
		{CreatedAt: now},               // fresh
		{CreatedAt: now - 40*msPerDay}, // 40d old → dropped by 30d retention
		{CreatedAt: now - 5*msPerDay},  // recent
	}
	s.SetPolicy(30, 200)
	if len(s.notifications) != 2 {
		t.Fatalf("age prune: want 2 kept (40d dropped), got %d", len(s.notifications))
	}
	for _, n := range s.notifications {
		if n.CreatedAt < now-30*msPerDay {
			t.Error("an entry older than the retention window survived")
		}
	}
}

func TestPruneCountUnreadOutliveRead(t *testing.T) {
	s := NewNotificationStateAt(filepath.Join(t.TempDir(), "n.json"))
	now := NowMS()
	// 10 entries, alternating read; even index = read, older as index grows.
	s.notifications = nil
	for i := 0; i < 10; i++ {
		s.notifications = append(s.notifications, StoredNotification{
			CreatedAt: now - float64(i)*1000,
			IsRead:    i%2 == 0,
		})
	}
	s.SetPolicy(0, 4) // no age gate, cap 4

	if len(s.notifications) != 4 {
		t.Fatalf("count cap: want 4 kept, got %d", len(s.notifications))
	}
	for _, n := range s.notifications {
		if n.IsRead {
			t.Error("under count pressure, read notifications should be dropped before unread")
		}
	}
}
