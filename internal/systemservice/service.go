// Package systemservice ports commands/system.rs, commands/window.rs, and plugins.rs.
// Exposes: GetAppVersion, StartWatching, StopWatching, LogRendererEvent,
//          GetAllTodos, WindowBusBroadcast, WindowBusReady, PluginsDiscover.
//
// application.Get() is only called here (and notifyservice) — never in pure logic packages.
package systemservice

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"claude-devtools/internal/discovery"
	"claude-devtools/internal/watcher"
)

// appVersion mirrors CARGO_PKG_VERSION from Cargo.toml. Keep in sync when bumping.
const appVersion = "0.1.0"

// SystemService exposes 8 platform/window/plugin commands.
type SystemService struct {
	ctx       context.Context
	watcherMu sync.Mutex
	runner    *watcher.Runner
}

func (s *SystemService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx
	return nil
}

// ServiceShutdown stops the file watcher if it is running.
func (s *SystemService) ServiceShutdown() error {
	s.watcherMu.Lock()
	r := s.runner
	s.runner = nil
	s.watcherMu.Unlock()
	if r != nil {
		r.Stop()
	}
	return nil
}

// Platform returns GOOS (already wired from the stub).
func (s *SystemService) Platform() (string, error) { return runtime.GOOS, nil }

// ---------------------------------------------------------------------------
// GetAppVersion (system.rs::get_app_version)
// ---------------------------------------------------------------------------

// GetAppVersion returns the application version string.
func (s *SystemService) GetAppVersion() (string, error) {
	return appVersion, nil
}

// ---------------------------------------------------------------------------
// StartWatching / StopWatching (lifecycle.rs)
// ---------------------------------------------------------------------------

// StartWatching begins recursive watching of ~/.claude/projects and
// ~/.claude/todos. Idempotent. Matches Rust start_watcher (command-triggered,
// not auto-started in ServiceStartup). Missing directories are retried every 2 s.
func (s *SystemService) StartWatching() error {
	claudeDir, ok := watcher.ResolveClaudeDir()
	if !ok {
		return fmt.Errorf("cannot resolve home directory")
	}
	projectsDir := filepath.Join(claudeDir, "projects")
	todosDir := filepath.Join(claudeDir, "todos")

	s.watcherMu.Lock()
	if s.runner != nil {
		s.watcherMu.Unlock()
		return nil // already watching
	}
	r := watcher.New(projectsDir, todosDir, func(event string, payload any) {
		emitEvent(event, payload)
	})
	s.runner = r
	s.watcherMu.Unlock()

	return r.Start()
}

// StopWatching stops all filesystem watches and cleans up goroutines.
// Matches Rust stop_watcher.
func (s *SystemService) StopWatching() error {
	s.watcherMu.Lock()
	r := s.runner
	s.runner = nil
	s.watcherMu.Unlock()
	if r != nil {
		r.Stop()
	}
	return nil
}

// ---------------------------------------------------------------------------
// LogRendererEvent (system.rs::log_renderer_event)
// ---------------------------------------------------------------------------

// LogRendererEvent writes a structured log entry from the renderer process.
func (s *SystemService) LogRendererEvent(level, msg string, ctx *json.RawMessage) error {
	attrs := []any{"target", "renderer"}
	if ctx != nil {
		attrs = append(attrs, "ctx", string(*ctx))
	}
	switch level {
	case "error":
		slog.Error(msg, attrs...)
	case "warn":
		slog.Warn(msg, attrs...)
	case "debug":
		slog.Debug(msg, attrs...)
	default:
		slog.Info(msg, attrs...)
	}
	return nil
}

// ---------------------------------------------------------------------------
// GetAllTodos (sessions.rs::get_all_todos — also exposed here per command registry)
// ---------------------------------------------------------------------------

// AggregatedSessionTodos mirrors sessions.rs::AggregatedSessionTodos.
// Duplication with sessionservice.AggregatedSessionTodos is intentional:
// both the SessionService and SystemService expose this command in the Tauri
// registry. They share identical logic; a shared type would require a new
// package. Since the type is trivial, inline it here per the Rust pattern.
type AggregatedSessionTodos struct {
	ProjectID string          `json:"projectId"`
	SessionID string          `json:"sessionId"`
	UpdatedAt float64         `json:"updatedAt"`
	Items     json.RawMessage `json:"items"`
}

// GetAllTodos aggregates todo JSON files across the given project IDs.
// Mirrors sessions.rs::get_all_todos.
func (s *SystemService) GetAllTodos(projectIDs []string) ([]AggregatedSessionTodos, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("cannot resolve home directory: %w", err)
	}
	claudeDir := filepath.Join(home, ".claude")
	projectsDir := filepath.Join(claudeDir, "projects")
	todosDir := filepath.Join(claudeDir, "todos")

	var out []AggregatedSessionTodos

	for _, projectID := range projectIDs {
		if !isValidProjectID(projectID) {
			continue
		}
		baseID := discovery.ExtractBaseDir(projectID)
		projectDir := filepath.Join(projectsDir, baseID)
		entries, err := os.ReadDir(projectDir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := entry.Name()
			if len(name) < 6 || name[len(name)-6:] != ".jsonl" {
				continue
			}
			sessionID := name[:len(name)-6]
			todoPath := filepath.Join(todosDir, sessionID+".json")
			if _, err := os.Stat(todoPath); os.IsNotExist(err) {
				continue
			}
			content, err := os.ReadFile(todoPath)
			if err != nil {
				continue
			}
			var items json.RawMessage
			if json.Unmarshal(content, &items) != nil {
				continue
			}
			info, err := os.Stat(todoPath)
			updatedAt := 0.0
			if err == nil {
				updatedAt = float64(info.ModTime().UnixMilli())
			}
			out = append(out, AggregatedSessionTodos{
				ProjectID: projectID,
				SessionID: sessionID,
				UpdatedAt: updatedAt,
				Items:     items,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	if out == nil {
		out = []AggregatedSessionTodos{}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// WindowBusBroadcast / WindowBusReady (window.rs)
// ---------------------------------------------------------------------------

// BroadcastInput mirrors window.rs::BroadcastInput.
type BroadcastInput struct {
	OriginWindowID string          `json:"originWindowId"`
	Topic          string          `json:"topic"`
	Seq            uint64          `json:"seq"`
	Payload        json.RawMessage `json:"payload"`
}

const broadcastEvent = "window-bus-message"

// WindowBusBroadcast emits window-bus-message with the given payload.
// Mirrors window.rs::window_bus_broadcast. App-nil-guarded.
func (s *SystemService) WindowBusBroadcast(message BroadcastInput) error {
	payload := map[string]any{
		"originWindowId": message.OriginWindowID,
		"topic":          message.Topic,
		"seq":            message.Seq,
		"payload":        message.Payload,
	}
	emitEvent(broadcastEvent, payload)
	return nil
}

// WindowBusReady emits window-bus-ready for the given window ID.
// Mirrors window.rs::window_bus_ready. App-nil-guarded.
func (s *SystemService) WindowBusReady(windowID string) error {
	emitEvent("window-bus-ready", map[string]any{"windowId": windowID})
	return nil
}

// emitEvent emits a Wails application event, guarded against a nil app.
// Same pattern as notifyservice.emitEvent.
func emitEvent(name string, payload any) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit(name, payload)
}

// ---------------------------------------------------------------------------
// PluginsDiscover (plugins.rs::plugins_discover)
// ---------------------------------------------------------------------------

// PluginEntry mirrors plugins.rs::PluginEntry.
type PluginEntry struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

const pluginsDirEnv = "CLAUDE_DEVTOOLS_PLUGINS_DIR"

func pluginsDir() (string, error) {
	if override := os.Getenv(pluginsDirEnv); override != "" {
		return override, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory")
	}
	return filepath.Join(home, ".claude-devtools", "plugins"), nil
}

// PluginsDiscover enumerates *.js files in the plugins directory.
// Mirrors plugins.rs::plugins_discover.
func (s *SystemService) PluginsDiscover() ([]PluginEntry, error) {
	dir, err := pluginsDir()
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return []PluginEntry{}, nil
	}
	return discoverPlugins(dir), nil
}

// discoverPlugins enumerates *.js files in dir. Mirrors plugins.rs::discover_plugins.
func discoverPlugins(dir string) []PluginEntry {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []PluginEntry{}
	}
	var out []PluginEntry
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".js" {
			continue
		}
		name := e.Name()
		id := name[:len(name)-3]
		out = append(out, PluginEntry{
			ID:   id,
			Path: filepath.Join(dir, name),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// ---------------------------------------------------------------------------
// OpenPath (Tauri opener plugin openPath equivalent)
// ---------------------------------------------------------------------------

// openPathCmd builds the OS-appropriate command to open target in the
// file manager / default app. Factored out so tests can inspect the
// command without actually launching it.
func openPathCmd(target string) *exec.Cmd {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", target)
	case "windows":
		return exec.Command("explorer", target)
	default:
		return exec.Command("xdg-open", target)
	}
}

// OpenPath opens target in the OS file manager or default application.
// Replaces the frontend file:// stopgap. Uses cmd.Start() to avoid blocking.
func (s *SystemService) OpenPath(target string) error {
	cmd := openPathCmd(target)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("open path: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Minimal inline path-validation helpers (avoids importing discovery here)
// These are limited to project-ID validity for GetAllTodos only.
// ---------------------------------------------------------------------------

func isValidProjectID(id string) bool {
	if id == "" || len(id) > 512 {
		return false
	}
	// Must start with '-' (or Windows "X--") and not contain null bytes.
	for _, ch := range id {
		if ch == 0 {
			return false
		}
	}
	return len(id) > 0 && id[0] == '-'
}

