package sessionservice

import "claude-devtools/internal/cache"

// SessionService exposes session discovery + detail. Methods are stubs in W1;
// real logic lands in W3–W5 (parsing/analysis port).
type SessionService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

// New injects the shared session cache (one instance for the whole app).
func New(c *cache.SessionCache) *SessionService { return &SessionService{cache: c} }

// ListProjects returns the encoded project folder names under ~/.claude/projects.
func (s *SessionService) ListProjects() ([]string, error) {
	return []string{}, nil
}
