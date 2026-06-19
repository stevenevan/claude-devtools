package systemservice

import (
	"context"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// SystemService exposes platform info + window/process commands and may emit
// window-bus events. Logic ported in W5/W7.
type SystemService struct {
	ctx context.Context
}

func (s *SystemService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx
	return nil
}

func (s *SystemService) ServiceShutdown() error { return nil }

// Platform returns the host GOOS (darwin|windows|linux).
func (s *SystemService) Platform() (string, error) { return runtime.GOOS, nil }
