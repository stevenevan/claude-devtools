package snapshotservice

import "claude-devtools/internal/cache"

type SnapshotService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

func New(c *cache.SessionCache) *SnapshotService { return &SnapshotService{cache: c} }

func (s *SnapshotService) Ready() (bool, error) { return true, nil }
