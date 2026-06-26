package snapshotservice

import (
	"strings"

	"claude-devtools/internal/cache"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/pipeline"
	"claude-devtools/internal/snapshots"
)

type SnapshotService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

func New(c *cache.SessionCache) *SnapshotService { return &SnapshotService{cache: c} }

func (s *SnapshotService) Ready() (bool, error) { return true, nil }

// SnapshotsList returns all snapshot metadata, newest first.
func (s *SnapshotService) SnapshotsList() ([]snapshots.SnapshotMeta, error) {
	return snapshots.ListSnapshots()
}

// SnapshotsCreateFromSession builds the session detail and snapshots it.
// label is optional; an empty/whitespace label falls back to the session id.
func (s *SnapshotService) SnapshotsCreateFromSession(projectID, sessionID string, label *string) (snapshots.SnapshotMeta, error) {
	detail, err := pipeline.BuildSessionDetail(projectID, sessionID)
	if err != nil {
		return snapshots.SnapshotMeta{}, err
	}
	resolved := detail.Session.ID
	if label != nil && strings.TrimSpace(*label) != "" {
		resolved = *label
	}
	return snapshots.CreateSnapshot(resolved, detail)
}

// SnapshotsDelete removes a snapshot by id.
func (s *SnapshotService) SnapshotsDelete(snapshotID string) error {
	return snapshots.DeleteSnapshot(snapshotID)
}

// SnapshotsOpen decompresses a snapshot back into a SessionDetail.
func (s *SnapshotService) SnapshotsOpen(snapshotID string) (domain.SessionDetail, error) {
	return snapshots.OpenSnapshot(snapshotID)
}
