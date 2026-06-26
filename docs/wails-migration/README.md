# Tauri → Wails Migration

Execution guide for porting `claude-devtools` from Tauri 2.x (Rust) to Wails v2 (Go).

> **Scope honesty:** ~95% of `src-tauri/src/` is pure data-transformation logic
> (`parsing/`, `analysis/`, `discovery/`, `analytics/`) with **zero Tauri coupling**.
> The Tauri→Wails swap is ~2 weeks; the other ~6 weeks are a Go rewrite of that
> pipeline + proving it emits byte-identical output. The migration's only durable
> wins are auto-generated TS bindings and goroutine simplicity. Proceed only if
> those justify rewriting a working, fast, tested codebase.

## Decision: target Wails **v3** (alpha)

Targeting **v3** despite alpha status (alpha.96, 2026-05-25 — "API reasonably stable,
apps in production"). Rationale:
- **Per-service `ServiceStartup(ctx, opts)`** — v3 injects `context.Context` into each
  service natively, matching the Phase 2 requirement directly (no manual ctx fan-out).
- **Native multi-window** — turns the stubbed `window-bus` commands into a real feature.
- **Typed events + transparent build** (Taskfile-driven CLI).

**Risk (accept explicitly):** v3 is pre-stable; the API can shift between alpha
releases. Pin an exact `wails/v3` version, re-pin deliberately, and budget for
binding/runtime churn. If a hard stable date is required before ship, v2 is the
fallback (single declarative `options.App`, `wailsjs/go/` bindings,
`runtime.EventsEmit(ctx, …)`). ([status](https://github.com/wailsapp/wails/issues/5052), [v3 docs](https://v3.wails.io/))

## Authoritative reference — check the docs when unsure

v3 is alpha; its API moves between releases. **Always verify Go/runtime API against the
official v3 docs before relying on a snippet here**, especially window/dialog/event APIs:
- v3 docs: https://v3.wails.io/  · install: https://v3.wails.io/quick-start/installation/
- The docs site returns **HTTP 403 to direct fetchers** — query it via context7
  (`/websites/v3_wails_io`, quick-start: `/websites/v3alpha_wails_io_quick-start`) instead.

Code in these week docs that was verified against the docs is marked "confirmed v3 API";
anything tagged "confirm against pinned alpha" must be checked before use.

## Verified library map (checked mid-2026)

| Concern | Rust crate | Go replacement | Status / why |
|---|---|---|---|
| App framework | `tauri` 2 | `github.com/wailsapp/wails/v3` | alpha (alpha.96+); pin exact version. CLI is `wails3`. |
| File watching | `notify` + `notify-debouncer-full` (FSEvents, recursive) | **`github.com/rjeczalik/notify`** | Recursive FSEvents. Stale (~2023) but FSEvents API is stable. **Do NOT use `fsnotify`**: non-recursive on macOS + kqueue opens 1 fd/file → exhausts descriptors on the thousands of JSONL files under `~/.claude/projects`. ([fsnotify caveats](https://github.com/fsnotify/fsnotify), [rjeczalik/notify](https://pkg.go.dev/github.com/rjeczalik/notify)) |
| Token counting | `tiktoken-rs` | **`github.com/weaviate/tiktoken-go`** | `pkoukk/tiktoken-go` is **unmaintained**; weaviate fork is actively maintained, has `o200k_base`/`cl100k_base`. Note: tiktoken is an OpenAI tokenizer used as a *Claude approximation* — requirement is parity with current `tiktoken-rs` output, not absolute correctness. ([fork note](https://pkg.go.dev/github.com/weaviate/tiktoken-go)) |
| LRU cache | `lru` 0.12 | `github.com/hashicorp/golang-lru/v2` | v2.0.7, generics, maintained. ([releases](https://github.com/hashicorp/golang-lru/releases)) |
| SSH | `russh` + `russh-keys` | `golang.org/x/crypto/ssh` + `golang.org/x/crypto/ssh/knownhosts` | stdlib-adjacent, maintained |
| SFTP | `russh-sftp` | `github.com/pkg/sftp` | de-facto standard |
| System notifications | `tauri-plugin-notification` | `github.com/gen2brain/beeep` | maintained (Dec 2025 commit); no tags → use `@latest` pseudo-version. ([repo](https://github.com/gen2brain/beeep)) |
| Launch at login | `tauri-plugin-autostart` | `github.com/spiretechnology/go-autostart` | launchd / systemd / Windows Service Manager behind one API. ([repo](https://github.com/spiretechnology/go-autostart)) |
| gzip (snapshots) | `flate2` | `compress/gzip` | stdlib |
| hashing | `sha2` | `crypto/sha256` | stdlib |
| JSON | `serde_json` | `encoding/json` | stdlib (+ explicit `json:` tags — see guardrails) |
| base64 | `base64` | `encoding/base64` | stdlib |
| dates | `chrono` | `time` | stdlib; RFC3339 ⇒ existing `reviveDates()` keeps working |
| regex | `regex` | `regexp` | both RE2 — semantics match |
| UUID | `uuid` | `github.com/google/uuid` | maintained |
| glob | `glob` | `path/filepath` / `github.com/bmatcuk/doublestar/v4` | doublestar for `**` |
| home dir | `dirs` | `os.UserHomeDir` | stdlib |
| async runtime | `tokio` | goroutines + channels | — |
| 2nd binary (CLI) | Cargo `[[bin]]` | `cmd/cli/main.go` importing `internal/` | cleaner in Go |

**No drop-in for:** folder dialogs (move server-side via `runtime.OpenMultipleDirectoriesDialog`),
`relaunch` (manual `os/exec` re-spawn or `runtime.Quit`), `opener` for file paths
(`os/exec` open/xdg-open/explorer; URLs use `runtime.BrowserOpenURL`).

## Target architecture (recap)

- **10 bound service structs** (`SessionService`, `SearchService`, `AnalyticsService`,
  `ConfigService`, `NotificationService`, `SshService`, `FilesService`,
  `SnapshotService`, `TimingService`, `SystemService`) replacing 119 `#[tauri::command]`s,
  registered via `application.NewService(&Svc{})` in `application.Options.Services`.
- **Lifecycle**: each event-emitting service implements
  `ServiceStartup(ctx context.Context, opts application.ServiceOptions) error` (Wails v3
  injects ctx per-service; returning an error aborts startup) and `ServiceShutdown() error`.
  No root-App ctx fan-out needed.
- **State**: Rust `Arc<Mutex<T>>` → Go struct + `sync.Mutex`/`RWMutex`. `ClaudeRoot`
  stays immutable (security boundary, resolved once at startup).
- **Events** (keep identical names): `file-change`, `todo-change`, `ssh-status`,
  `notification:new|updated|clicked`, `window-bus-message`, `window-bus-ready`.
  Backend emits via `application.Get().Event.Emit(name, data)`; frontend listens via
  `import { Events } from '@wailsio/runtime'` → `Events.On(name, cb)` (returns a cleanup fn).
- **Bindings** generated under `frontend/bindings/<module>/...` (NOT v2's `wailsjs/go/`);
  regenerate with `wails3 generate bindings -ts` (auto during `wails3 dev`).
- **Frontend blast radius is tiny**: components never import `@tauri-apps` — everything
  funnels through `src/renderer/api/domain/*.ts` behind a `Proxy`. You rewrite ~6 files.

## The parity gate (most important artifact)

Before porting any logic, snapshot the **current Rust** output as golden files:

```bash
# run against N real sessions from ~/.claude/projects
src-tauri/target/release/claude-devtools-cli show-session <project> <id> --format json \
  > docs/wails-migration/golden/<id>.json
```

Every ported Go module must reproduce these byte-for-byte (after key-sorted JSON
normalization). This is the acceptance gate for Weeks 3–5. No parity = not done.

## Week index

| Doc | Weeks | Phase |
|---|---|---|
| [week-01.md](week-01.md) | 1 | Init & scaffolding |
| [week-02.md](week-02.md) | 2 | Lib layout, window chrome, parity harness |
| [week-03.md](week-03.md) | 3 | Port `parsing/` + watcher |
| [week-04.md](week-04.md) | 4 | Port `analysis/` + tokenizer (parity gate) |
| [week-05.md](week-05.md) | 5 | Port `discovery/analytics/config/ssh/snapshots/notifications` + CLI + bind all |
| [week-06.md](week-06.md) | 6 | Frontend: invoke→bindings, events |
| [week-07.md](week-07.md) | 7 | Frontend: dialogs/opener/window/process + smoke test |
| [week-08.md](week-08.md) | 8 | Tauri purge, validation, optimization |

## Guardrails (read before W6)

See per-week "Risks" sections. The recurring killers:
1. **JSON casing** — serde `rename_all="camelCase"` everywhere; Go needs explicit `json:"name"` on **every** field or the frontend silently misses it.
2. **nil slice → `null`** (Rust `Vec` → `[]`); init slices as `[]T{}`.
3. **Optional `time.Time`** → use `*time.Time` (zero value serializes as `0001-01-01`, not `null`).
4. **Lock across SSH I/O** — copy handle under lock, release, then do network I/O.
5. **Panics crash the app** — `recover()` at every goroutine boundary; bound methods return `error`.
6. **Early events are lost** — emit only after the frontend has registered `Events.On`
   (gate the watcher's first flush on a frontend "ready" event, or have the UI request
   initial state explicitly). `ServiceStartup` runs before the window mounts.
