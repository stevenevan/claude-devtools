package notifyservice

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// NotificationService matches triggers and emits notification:* events.
// Logic ported in W5.
type NotificationService struct {
	ctx context.Context
}

func (s *NotificationService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx
	return nil
}

func (s *NotificationService) ServiceShutdown() error { return nil }

// GetState returns whether the notification engine is active.
func (s *NotificationService) GetState() (bool, error) { return true, nil }
