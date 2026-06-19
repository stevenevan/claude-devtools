package sshservice

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// SshService manages SSH/SFTP connections and emits ssh-status events.
// Event-emitting → implements the v3 lifecycle hooks. Logic ported in W5.
type SshService struct {
	ctx context.Context
}

func (s *SshService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx // captured for goroutines; events emit via application.Get()
	return nil
}

func (s *SshService) ServiceShutdown() error { return nil }

// GetState returns the current SSH connection status.
func (s *SshService) GetState() (string, error) { return "disconnected", nil }
