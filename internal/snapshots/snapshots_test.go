package snapshots

import (
	"testing"

	"claude-devtools/internal/domain"
)

func fixtureDetail() domain.SessionDetail {
	ongoing := false
	return domain.SessionDetail{
		Session: domain.Session{
			ID:          "sess-1",
			ProjectID:   "proj-1",
			ProjectPath: "/tmp/test",
			CreatedAt:   0.0,
			IsOngoing:   &ongoing,
		},
		Messages:  []domain.ParsedMessage{},
		Chunks:    []domain.EnhancedChunk{},
		Processes: []domain.Process{},
	}
}

// Ports snapshots.rs round_trip_snapshot_compresses_and_restores.
func TestRoundTripSnapshotCompressesAndRestores(t *testing.T) {
	t.Setenv("CLAUDE_DEVTOOLS_SNAPSHOTS_DIR", t.TempDir())
	detail := fixtureDetail()

	meta, err := CreateSnapshot("Test snapshot", detail)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if meta.SizeBytes == 0 {
		t.Fatal("compressed payload should be non-empty")
	}

	listed, err := ListSnapshots()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !containsID(listed, meta.ID) {
		t.Fatal("snapshot should appear in list")
	}

	restored, err := OpenSnapshot(meta.ID)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if restored.Session.ID != detail.Session.ID {
		t.Fatalf("restored session id = %q, want %q", restored.Session.ID, detail.Session.ID)
	}

	if err := DeleteSnapshot(meta.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	after, _ := ListSnapshots()
	if containsID(after, meta.ID) {
		t.Fatal("snapshot should be gone after delete")
	}
}

func TestListNewestFirst(t *testing.T) {
	t.Setenv("CLAUDE_DEVTOOLS_SNAPSHOTS_DIR", t.TempDir())
	for i := 0; i < 3; i++ {
		if _, err := CreateSnapshot("s", fixtureDetail()); err != nil {
			t.Fatal(err)
		}
	}
	listed, err := ListSnapshots()
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < len(listed); i++ {
		if listed[i-1].CreatedAt < listed[i].CreatedAt {
			t.Fatal("list must be newest-first")
		}
	}
}

func containsID(metas []SnapshotMeta, id string) bool {
	for _, m := range metas {
		if m.ID == id {
			return true
		}
	}
	return false
}
