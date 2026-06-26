package configservice

import (
	"context"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// TestServiceStartupNoError verifies that ServiceStartup does not return an
// error on a default (zero-value) ConfigService. Autostart Enable/Disable
// failures are logged and swallowed, so the call must always return nil.
func TestServiceStartupNoError(t *testing.T) {
	svc := &ConfigService{}
	err := svc.ServiceStartup(context.Background(), application.ServiceOptions{})
	if err != nil {
		t.Errorf("ServiceStartup returned unexpected error: %v", err)
	}
}

// TestServiceShutdownNoError is a trivial smoke test for the lifecycle hook.
func TestServiceShutdownNoError(t *testing.T) {
	svc := &ConfigService{}
	if err := svc.ServiceShutdown(); err != nil {
		t.Errorf("ServiceShutdown returned unexpected error: %v", err)
	}
}
