package sessionservice

// SessionService exposes session discovery + detail. Methods are stubs in W1;
// real logic lands in W3–W5 (parsing/analysis port).
type SessionService struct{}

// ListProjects returns the encoded project folder names under ~/.claude/projects.
func (s *SessionService) ListProjects() ([]string, error) {
	return []string{}, nil
}
