package timingservice

import "claude-devtools/internal/cache"

type TimingService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

func New(c *cache.SessionCache) *TimingService { return &TimingService{cache: c} }

func (s *TimingService) Ready() (bool, error) { return true, nil }
