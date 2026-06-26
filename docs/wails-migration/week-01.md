# Week 1 — Project Init & Core Scaffolding (Wails v3)

**Objective:** A Wails v3 app that boots, loads the existing React frontend in dev,
and exposes service structs that auto-generate TypeScript bindings.

**Prerequisites:** **Go 1.25+** (v3 requirement), Wails v3 CLI, existing repo for copying
the frontend. ([v3 install docs](https://v3.wails.io/quick-start/installation/))
```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest   # pin to a specific alpha after init
wails3 doctor
```

## Tickets

### W1-T1 — Scaffold the Wails v3 project
```bash
wails3 init -l                       # list available templates first
wails3 init -n claude-devtools -t react-ts   # use the exact template id from the list
```
- Keep the new project at repo root (`frontend/` for UI, Go packages at root + `internal/`).
  The Tauri tree (`src-tauri/`, `src/`) stays untouched until Week 8 — run both side by side.
- **Pin the alpha**: edit `go.mod` to an exact `github.com/wailsapp/wails/v3 v3.0.0-alpha.NN`
  (don't float on `@latest` — alpha APIs move). Record the version in `README.md`.
- Verify: `wails3 doctor` green.

### W1-T2 — Port the frontend into `frontend/`
- Copy `src/renderer/**` → `frontend/src/`. The React app is transport-agnostic.
- Port Vite aliases (`@renderer`, `@shared`), Tailwind 4 + `index.css` theme variables,
  Zustand 5, `@tanstack/react-virtual`, lucide-react.
- Add the v3 runtime: `bun add @wailsio/runtime` (frontend event/window API).
- Use **bun** (project standard).
- Verify: `cd frontend && bun run build` — fails only on `@tauri-apps` imports (swapped W6).

### W1-T3 — Define services with v3 lifecycle hooks
v3 injects `context.Context` per-service via `ServiceStartup`. Event-emitting services
(SSH, notifications, system, watcher) implement it; pure-logic services (sessions,
analytics, search, files, snapshots, timing) often need no lifecycle hook at all.

```go
// internal/sshservice/service.go
package sshservice

import (
	"context"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type SshService struct {
	ctx context.Context
	// state ...
}

func (s *SshService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.ctx = ctx // captured for any goroutine that needs it; events use application.Get()
	return nil
}
func (s *SshService) ServiceShutdown() error { return nil }

// Bound method: auto-generates TS. Returns (T, error) → JS promise resolve/reject.
func (s *SshService) GetState() (SSHStatus, error) { /* ... */ }
```

### W1-T4 — `main.go` with `application.New` + all services
```go
package main

import (
	"embed"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name: "claude-devtools",
		Services: []application.Service{
			application.NewService(&sessionservice.SessionService{}),
			application.NewService(&searchservice.SearchService{}),
			application.NewService(&analyticsservice.AnalyticsService{}),
			application.NewService(&configservice.ConfigService{}),
			application.NewService(&notifyservice.NotificationService{}),
			application.NewService(&sshservice.SshService{}),
			application.NewService(&filesservice.FilesService{}),
			application.NewService(&snapshotservice.SnapshotService{}),
			application.NewService(&timingservice.TimingService{}),
			application.NewService(&systemservice.SystemService{}),
			// watcher registered here too (W3) — it's a service with ServiceStartup
		},
		Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "claude-devtools",
		Width:     1400, Height: 900,
		MinWidth:  900, MinHeight: 600,
		// Mac titlebar chrome added in W2
	})

	if err := app.Run(); err != nil {
		panic(err)
	}
}
```
- Add one bound method per service so binding generation has something to emit.

### W1-T5 — Generate & confirm bindings
```bash
wails3 generate bindings -ts   # also runs automatically during `wails3 dev`
wails3 dev
```
- Verify: `frontend/bindings/<module>/...` appears (per-service `.ts`), `@wailsio/runtime`
  resolves, and the stub methods are callable from the browser devtools console.

## Exit criteria
- [ ] `wails3 dev` launches a window with the React app (broken only on Tauri imports).
- [ ] `frontend/bindings/` generated for all 10 services.
- [ ] `wails/v3` pinned to an exact alpha version; both stacks coexist.

## Risks this week
- **Floating alpha**: `@latest` will drift mid-project. Pin and bump deliberately.
- **Bindings path differs from v2** (`frontend/bindings/`, not `wailsjs/go/`) — wire the
  frontend adapter imports (W6) to the right path.
- **Frontend dist path**: align Vite `build.outDir` with the `//go:embed all:frontend/dist`
  directive and `wails3` expectations.
