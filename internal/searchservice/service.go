package searchservice

import "claude-devtools/internal/cache"

type SearchService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

func New(c *cache.SessionCache) *SearchService { return &SearchService{cache: c} }

func (s *SearchService) Ready() (bool, error) { return true, nil }
