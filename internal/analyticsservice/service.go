package analyticsservice

import "claude-devtools/internal/cache"

type AnalyticsService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

func New(c *cache.SessionCache) *AnalyticsService { return &AnalyticsService{cache: c} }

func (s *AnalyticsService) Ready() (bool, error) { return true, nil }
