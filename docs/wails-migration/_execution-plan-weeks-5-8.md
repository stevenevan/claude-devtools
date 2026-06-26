# Execution Plan — Wails Migration Weeks 5–8

Status: APPROVED (metis ✓ · architect-reviewer ✓ · momus GO ✓)
Scope: Execute `docs/wails-migration/week-05.md` … `week-08.md`.
Owner outcome: Tauri fully removed; Wails v3 (Go) app ships with the existing React
UI, **all 118 commands** ported + bound, frontend on v3 bindings/events, no
`@tauri-apps` import anywhere, regression + parity green, signed builds produced.

## Context

- Continues the W1–4 effort (`_execution-plan-weeks-1-4.md`, APPROVED, parity gate
  GREEN as of commit `c6d3607`). The hard transform-parity work (`parsing/` +
  `analysis/` → byte-identical Go) is **done**.
- W5–8 is the *rest of the iceberg*: the non-pipeline backend (discovery, analytics,
  config, notifications, ssh, snapshots, timing, plugins, nl_query, summarizer, files,
  window-bus), the real CLI binary, the frontend data/event swap, the Tauri purge, and
  packaging/signing.
- Tauri stack (`src-tauri/`, root `src/`) stays **untouched and runnable** until W8-T1.
  Both stacks coexist; nothing before W8 deletes Rust/Tauri code.
- **`bun` only** (never npm/yarn/pnpm). **Commit per ticket**, staging **explicit paths**
  (never `git add -A` — untracked plan docs get swept in). Branch: `feat/wails-migration`.
- **v3 is alpha (pinned `v3.0.0-alpha2.104`).** Verify every window/dialog/event/service
  snippet against the pinned alpha via **context7** before relying on it
  (`/websites/v3_wails_io`; the docs site 403s direct fetch). This is a hard rule for W7.

## Verified current state (recon done)

| Fact | Value | Impact |
|---|---|---|
| Go / wails3 | go **1.25.0**; `wails3` installed, `go.mod` pins **`v3.0.0-alpha2.104`** | toolchain ready; no pre-flight blocker |
| Parity gate | GREEN (`internal/paritytest`, `pipeline.BuildSessionDetailJSON` → golden diff) | W3–4 contract holds; golden committed under repo-root `golden/` |
| Go services | all 10 structs exist as **bare stubs** (`internal/<svc>service/service.go`, ≤1 method each) | W5 fills bodies; SshService already has the v3 lifecycle hooks |
| CLI | `cmd/` is **empty** — parity harness calls `pipeline.BuildSessionDetailJSON` directly | the real CLI binary (`cmd/cli/main.go`) is **net-new W5-T7 work** |
| Command inventory | **118 entries** in Rust `lib.rs` `invoke_handler` (+`get_app_version`) | exit gate "all 118 bound" must enumerate every one — see W5-T0 |
| W5 Rust LOC | discovery 1869 · analytics 2018 · config 3142 · notifications 2260 · ssh 1653 · snapshots 228 · timing 253 | ≈10.4k LOC port; harness is NOT the loop here (most is off-gate) |
| Off-gate W2 stubs | `analysis/{error_hotspots,tool_analytics,content_search,file_graph,summarizer}` + `session_parser/incremental` + `tool_linking` | must become **real** in W5 (they back live commands), not left stubbed |
| Frontend | `frontend/src/**` ported; `frontend/bindings/` exists; `@tauri-apps` still imported in **6 files** (`lib/logger.ts`, `api/domain/{analytics,config,system,files,sessions}.ts`) | W6–7 break surface is small and known |

## The command-inventory reconciliation (W5-T0 — do FIRST)

Week-05's T1–T8 names discovery/analytics/config/notifications/ssh/snapshots/CLI but
does **not** enumerate every handler entry. The exit gate is "all 118 bound", so before
porting, produce the authoritative map. Domains in the 118-entry handler **not** spelled
out by T1–T8, with their owning service:

| Command(s) | Rust source | Go owner | Notes |
|---|---|---|---|
| `read_claude_md_files`, `read_directory_claude_md`, `read_mentioned_file`, `validate_path`, `validate_mentions`, `read_agent_configs`, `read_global_{agents,skills,plugins,settings}` | `commands/files.rs`, `commands/path_util.rs`, `commands/agents_search/` | **FilesService** | trust-boundary path validation — port guards verbatim |
| `search_sessions`, `search_all_projects`, `search_sessions_filtered`, `search_session_content`, `get_waterfall_data`, `get_subagent_detail`, `get_session_groups`, `get_repository_groups`, `get_worktree_sessions` | `commands/sessions.rs`, `discovery/` | **SearchService** + discovery | bulk of discovery surface |
| `context_list`, `context_get_active`, `context_switch` | `agents_search/context.rs` | SessionService/discovery | **hardcoded stubs (metis M4) — no state/mutex; port the constants verbatim** |
| `get_session_detail_incremental`, `parse_session`, `parse_session_metrics`, `session_scroll_to_line`, `get_session_tldr` | `parsing/session_parser/incremental.rs`, `analysis/summarizer` | SessionService | **incremental reader** (D4 deferral) + **summarizer** become real here |
| `link_tool_calls`, `count_tokens`, `count_tokens_batch` | `analysis/tool_linking.rs`, `analysis/tokenizer.rs` | SessionService/Analytics | tool_linking (arch H2 deferral) + **real `weaviate/tiktoken-go`** become real here |
| `window_bus_broadcast`, `window_bus_ready` | `commands/window.rs` | **SystemService** | Rust is just `app.emit(BROADCAST_EVENT, payload)` (single-app broadcast) → `application.Get().Event.Emit(...)`; **don't architect multi-window** (metis L1) unless context7 confirms the pinned alpha changed broadcast scope |
| `plugins_discover` | `commands/.../plugins` | FilesService/System | discovery of installed plugins |
| `parse_nl_query` | `nl_query.rs` | SearchService | natural-language query parse |
| `get_backend_timings`, `get_cache_stats`, `set_cache_capacity`, `clear_session_cache` | `timing.rs` | **TimingService** | cache stats + `SessionCache` capacity |
| `start_watching`, `stop_watching`, `log_renderer_event`, `get_app_version`, `get_all_todos` | `commands/system.rs`, watcher | SystemService | watcher already ported W3-T5; wire the start/stop commands |

**Deliverable of W5-T0:** a checklist file `docs/wails-migration/_command-inventory.md`
listing all 118 commands → owning Go service + Rust source path, each with a `[ ]` box.
W5-T8 closes it; W8-T2 audits it. This is the single source of truth for "are we done".

## Pre-flight (resolve before W5 body work)

P0. **Real-host SSH availability (D-SSH).** W5-T5 verification ("connect/disconnect/test
    against a real host") needs a reachable SSH host with a remote `~/.claude/projects`.
    Confirm one exists; if not, define the fallback acceptance: a `localhost`/container
    `sshd` fixture, or mark SSH live-verify as **manual-deferred to W8** and unit-test the
    `ssh-status` state sequence + retry/known-hosts logic in isolation. Decide now.
P1. **Off-gate golden corpora (arch L1 — mirror the W2 `golden/` convention).** The
    CLI-stubbed parity gate does NOT cover analytics/tokenizer/summarizer; capture their Rust
    output as committed fixtures **before** porting so they're gated, not guessed, and
    re-runnable in W8-T2: `golden/tokenizer-corpus.json` (Rust `count_tokens` over ~50 varied
    strings — ASCII, unicode, code, emoji), `golden/analytics/<id>.json` (Rust analytics
    output per golden session), summarizer fixture.
P2. **`beeep` pin.** No tags → `go get github.com/gen2brain/beeep@<commit>` pseudo-version;
    record the commit in `go.mod` + README. Same for any other untagged dep.
P3. **Snapshot format capture.** Before touching `snapshots/`, create one snapshot with
    the **Rust** app and keep it as a fixture — W5-T6 must open it byte-faithfully
    (on-disk gzip format frozen for cross-version compatibility).

## Phase W5 — Port remaining backend + CLI + bind everything

Goal: every one of the 118 commands has a bound Go method generating TS; parity harness
still green; the off-gate W2 stubs are now real. Commit per ticket (T0…T9).

- **W5-T0 Command inventory** (above) → `_command-inventory.md`. Verify the count is 118
  and every entry maps to exactly one service. *Verify:* checklist committed; reviewers
  use it as the done-contract.
- **W5-T0.5 `cache/` + shared-instance wiring (metis C2 + arch C1/H1 — compile-time
  prerequisite for T1 onward, do before T1)** —
  - port `src-tauri/src/cache.rs` (465 LOC) → `internal/cache/cache.go`: LRU + TTL +
    byte-budget eviction + `IncrementalState` (`byte_offset` + `SessionFileMetadata`,
    `cache.rs:35`). Use `github.com/hashicorp/golang-lru/v2`. **The cache owns its own
    `sync.Mutex` internally; callers never lock it.**
  - **Layering (arch H1):** `domain ← parsing ← {cache, pipeline} ← services`. `internal/cache`
    imports **only `domain` + `parsing`** (matches `cache.rs:9-10` importing `domain` +
    `session_parser::SessionFileMetadata`) — **never `pipeline`, `analysis`, or any
    `*service`**. The cache-orchestration logic (lock cache → check incremental → call pure
    `pipeline` → write cache, `commands/sessions.rs:152-289`) is **service-layer code in
    SessionService**, not added to `pipeline`/`analysis`.
  - **Single-instance injection (arch C1 — the #1 concurrency risk):** v3 services are
    independent structs with no DI graph (no Tauri `.manage()` equivalent). In Rust one
    `Arc<Mutex<SessionCache>>` is shared across SessionService, AnalyticsService,
    SnapshotService, TimingService, SearchService (`lib.rs:41`). In Go: **construct one
    `*cache.SessionCache` in `main.go` and pass the same pointer into each service's
    constructor** (`NewSessionService(c)`, `NewAnalyticsService(c)`, …). **A service must
    NEVER import another service to reach the cache** — that is the cycle smell; forbid it.
  - Extend the W2-T1 `domain`-leaf import-check test to also assert **`cache` never imports
    `pipeline`/`analysis`/any `*service`**, so a later port can't violate the layering.
  Required by discovery listing (T1), `parse_session`/`get_analytics` (T2),
  `get_session_detail_incremental` (T8a), and TimingService's
  `get_cache_stats`/`set_cache_capacity`/`clear_session_cache`. Port the existing cache unit
  tests (`cache.rs:287` `test_set_and_get_incremental` et al). *Verify:* cache unit tests
  green; LRU eviction + TTL + incremental get/set behave as Rust; import-check test passes;
  `main.go` injects one shared instance into the 5 consuming services.
- **W5-T1 `discovery/`** — `project_scanner`, `session_lister` (paginated + sorting),
  `path_decoder` (`/Users/x/p ↔ -Users-x-p`), `subagent_resolver`/`locator`,
  `ongoing_detector`, `subproject_registry`, `content_filter`. **(arch H2 — resolve the
  doc contradiction) `SubprojectRegistry` IS real shared state** (`subproject_registry.rs:18`
  `entries: HashMap`, `register`/`get_session_filter`/`clear`; injected
  `Arc<Mutex<SubprojectRegistry>>` at `lib.rs:42`): port the struct with a `sync.Mutex` and
  apply the **same single-instance injection rule as the cache (arch C1)** — construct once in
  `main.go`, pass the pointer to the services that filter sessions by it. **What's stub is the
  *commands*, not the registry (metis H1):** `context_list`/`context_get_active`/
  `context_switch` (`agents_search/context.rs` — return `json!([{"id":"local",…}])` etc.),
  `get_session_groups`/`get_repository_groups`/`get_worktree_sessions` (constant `vec![]`-ish),
  `get_waterfall_data` (one-line alias for `get_session_detail`) — port those verbatim, no new
  logic. Reuse Rust unit tests as Go table tests. *Verify:* project/session listing +
  pagination match Rust on the user's real `~/.claude/projects`; path decode round-trips;
  stub commands return the same constants; registry `register`/`get_session_filter` round-trip.
- **W5-T2 `analytics/` + `analysis/commands` + real tokenizer** — commands: `get_analytics`,
  `get_cost_forecast`, `get_productivity_metrics`, `get_session_duration_stats`,
  **`get_model_comparison`** (metis C4 — `analytics/model_comparison.rs`, was omitted);
  `get_tool_analytics`, `get_tool_time_heatmap`, `get_error_hotspots`, `get_error_clusters`,
  `get_file_graph` (the W2 off-gate stubs become real). Helper modules (internal, not
  commands): `aggregate`, `buckets`, `cost`, `duration`, `productivity`, `forecasting`,
  `session_scan` (metis M5 — `session_scan` is a helper used by `get_analytics`, not its own
  command). Plus **`tool_linking`** (arch H2 deferral, backs `link_tool_calls` + analytics
  maps — sort keys, Rust serialized a HashMap); **real `weaviate/tiktoken-go` `cl100k_base`**,
  encoder cached, gated against the P1 corpus. *Verify:* analytics diff-clean vs Rust on
  golden sessions; `count_tokens` matches `tiktoken-rs` on the 50-string corpus.
- **W5-T3 `config/` (atomic persist)** — `ConfigState` behind `sync.Mutex`; **exactly 40
  `config_*` commands** (metis H2 — `lib.rs` has 40 `config::commands::*`; week-05.md's "45"
  miscounts by lumping in notifications/webhook/plugins, which land in T4/T8). **Atomic
  writes: temp file + `os.Rename`** (never truncate-in-place). `import/export annotations`
  keep schema identical. **`config_open_in_editor` (`config/commands.rs:211`, momus FIX1)
  takes NO path argument — it opens the fixed `state.get_config_path()` via the OS opener
  (Rust: `tauri_plugin_opener`; Go: `os/exec` `open`/`xdg-open`/`explorer`). No arbitrary
  path → no injection surface; just port the fixed-path open.** *Verify:* round-trip each
  mutation; on-disk JSON shape matches Rust; a kill-mid-write leaves the old file intact;
  `config_open_in_editor` opens the config file and nothing else.
- **W5-T4 `notifications/`** — `manager` (state), `trigger_matcher`, `error_detector`,
  `webhook` (stdlib `net/http`), system toasts via `beeep`. Emit
  `notification:new|updated|clicked` via `application.Get().Event.Emit(...)`.
  *Verify:* trigger-matching parity on fixture sessions; `webhook_test_send` posts;
  toast fires on macOS.
- **W5-T5 `ssh/`** — `golang.org/x/crypto/ssh` + `knownhosts`; `pkg/sftp`. Port
  `config_parser`, `retry`, `agent_discovery`, `known_hosts`. **(metis H4) Rust uses
  `tokio::sync::Mutex` held across `.await` (`ssh/commands.rs:15,39,86`) — the Go port must
  NOT replicate that: `sync.Mutex` is released BEFORE `connectWithRetry` runs and re-taken
  only for the handle swap (`s.mu.Lock(); s.conn = conn; s.mu.Unlock()`), never across
  network I/O.** Emit `ssh-status` connecting→retrying*→connected/error. *Verify:* per P0 —
  real host if available, else fixture/unit-test the status sequence + retry + known-hosts;
  **add a unit test: concurrent `Connect` + `GetState` do not deadlock** (proves the lock
  isn't held across I/O); mark any live-verify deferred-to-W8 explicitly.
- **W5-T6 `snapshots/`** — gzip via `compress/gzip`; create/open/list/delete. **On-disk
  format frozen** (P3 fixture must open). *Verify:* create→open round-trips to the same
  `SessionDetail`; the Rust-made fixture opens.
- **W5-T7 `cmd/cli/main.go` (read-only CLI — net-new)** — imports `internal/`; subcommands
  `list-projects`, `list-sessions`, `show-session --format json|markdown`, `tail`, `stats`.
  **Port the `bin/cli.rs` security guards verbatim** (ID allowlist: ASCII
  alnum/dash/underscore/dot + max len; home canonicalization ignoring `CLAUDE_HOME`/`HOME`
  override; tail rate-limit 10 MB/s, 100k lines). Reuse the **same `Session` stub const
  block** the parity harness pins (`cli.rs:168-186`). *Verify:* `go run ./cmd/cli
  show-session … --format json` reproduces the golden files; guard unit tests pass.
- **W5-T8a Incremental reader + summarizer (metis C3 — split out; each is a standalone
  port with its own state/tests)** — `get_session_detail_incremental`: port the 4-way cache
  state machine in `commands/sessions.rs:216-293` (the `match (inc_state, cached_session)`
  block at 233-293: delta-append vs full-parse, with an empty-delta short-circuit in the
  first arm), reading/writing `byte_offset`
  via the W5-T0.5 cache. `analysis/summarizer.rs` (221 LOC) backs `get_session_tldr`.
  *Verify (metis H5):* call `GetSessionDetailIncremental` twice on one session; after
  appending bytes between calls, assert the second call reads `byte_offset` from cache and
  skips already-parsed bytes (not a full re-parse). Summarizer output matches Rust on a
  fixture.
- **W5-T8b Remaining services + bind all** — FilesService (claude_md/agent-config/global-*/
  validate/plugins), SearchService (`parse_nl_query`, search surface), TimingService
  (`get_cache_stats`/`set_cache_capacity`/`clear_session_cache` over the W5-T0.5 cache),
  SystemService (`window_bus_*`, `start/stop_watching`, `get_app_version`,
  `log_renderer_event`, `get_all_todos`). Then `wails3 generate bindings -ts`. *Verify:*
  `_command-inventory.md` fully checked; every command has a generated TS fn under
  `frontend/bindings/`; `go build ./...` + `go test ./...` green; parity still green.

Exit (week-05): all 118 bound; SSH/notifications/snapshots/config verified; Go CLI
reproduces golden; security guards intact; `_command-inventory.md` 118/118.

## Phase W6 — Frontend: invoke → bindings, events

Goal: data-call + event layers in `src/renderer/api/domain/*.ts` move from `@tauri-apps`
to v3 bindings + `@wailsio/runtime`. **No component file changes** (everything funnels
through the `Proxy` in `api/index.ts`).

> **Path note (arch M2/M3 — resolved against the live tree):** edits land in
> **`frontend/src/renderer/api/domain/*.ts`** + **`frontend/src/renderer/lib/logger.ts`** —
> the tree `wails3 dev` serves. The dormant **root `src/`** is the old Tauri copy; its
> `@tauri-apps` imports are EXPECTED until the W8-T1 purge and are NOT a W6 regression (the W6
> grep gate targets `frontend/src` only). **Bindings import from the verified generated path
> `frontend/bindings/claude-devtools/internal/<svc>service` (e.g.
> `.../claude-devtools/internal/sessionservice`) — hyphenated `claude-devtools` (the `go.mod`
> module name) AND the `internal/` segment, NOT the `claudedevtools/<service>` literal in the
> week-06 snippets**; it is also not v2's `wailsjs/go/`.

- **W6-T1 `sessions.ts`** — convert all 10 session/project/todo/detail/incremental/by-ids
  calls; `invoke('x',{a,b})` → `X(a,b)` (**positional**). Keep `reviveDates` on its current
  5 call sites. *Verify:* session list + detail render identically; dates are `Date`.
- **W6-T2 `analytics.ts`, `files.ts`** — mechanical invoke→binding swap; watch arg **order**.
  *Verify:* dashboards, file-graph, CLAUDE.md panels render.
- **W6-T3 `config.ts` (data + notification events)** — 40 config calls + notifications CRUD
  → bindings; `notification:new|updated|clicked` via `Events.On`, reading **`e.data`** (not
  `e.payload`); preserve the "return a cleanup fn" contract. **(metis L4) `config.ts` also
  calls `notifications_test_trigger` — its bound method lives on `notificationservice`, not
  `configservice`; import it from the right bindings module even though it's invoked from the
  config domain surface.** *Verify:* notifications panel updates live; unread count tracks.
- **W6-T4 `system.ts` event listeners** — `file-change`, `todo-change`, `ssh-status` →
  `Events.On(name, e => cb(e.data))`, returning cleanup for `useEffect` teardown. *Verify:*
  editing a JSONL refreshes the session; SSH status badge updates.
- **W6-T5 `lib/logger.ts`** — the 6th `@tauri-apps` importer (not in the doc's T-list,
  `logger.ts:1` imports `invoke` from `@tauri-apps/api/core`). Swap its
  `invoke('log_renderer_event', …)` to the bound method. *Verify (metis M1):* renderer logs
  reach the Go side; `grep -rn '@tauri-apps' frontend/src` run after T5 shows only the W7
  plugin usages remain (data/event layer fully off Tauri).

Exit (week-06): sessions/analytics/files/config use `frontend/bindings/`; all listeners use
`Events.On` reading `e.data`, returning cleanup; **no component file changed**.

## Phase W7 — Frontend: dialogs / opener / window / process + autostart + smoke

Goal: replace remaining Tauri plugin usages; **zero `@tauri-apps` import remains**.
**Every v3 builder/method here is verified against the pinned alpha via context7 first** —
the dialog/window APIs shift between alphas; do not trust the doc snippets blindly.

- **W7-T1 Folder dialogs → bound `ConfigService` method** — Tauri's client-side
  `open({directory})` becomes Go-side `app.Dialog`. Confirm the exact v3 builder
  (`OpenFile().CanChooseDirectories(true)…` vs a directories-specific builder) + whether
  multi-select exists in the pinned alpha; if not, single-folder is the accepted
  simplification. Never return `nil` → frontend expects `[]`. *Verify:* picker opens;
  returns paths.
- **W7-T2 Opener** — URLs: `Browser.OpenURL` from `@wailsio/runtime`. File paths: bound
  `SystemService.OpenPath` via `os/exec` (`open`/`xdg-open`/`explorer`). *Verify:* "open in
  finder/editor" + external links work.
- **W7-T3 Window controls** — `Window.Minimise()`/`Close()` from `@wailsio/runtime`;
  maximize **toggle** via bound `SystemService.WindowToggleMaximise()`
  (`IsMaximised()?UnMaximise():Maximise()`). *Verify:* titlebar buttons work; toggle correct.
- **W7-T4 Process relaunch + version** — `relaunch`: **decide now** (re-spawn via `os/exec`
  + exit, or replace UX with `Application.Quit()`) — don't discover the gap at smoke test.
  `getVersion` → bound `SystemService.GetAppVersion()`. *Verify:* version renders; relaunch
  path works or is deliberately removed.
- **W7-T5 Autostart — BEHAVIOR FIX, not a port (arch M1)** —
  `github.com/spiretechnology/go-autostart` (Enable/Disable/IsEnabled); macOS user-level
  `~/Library/LaunchAgents`. **In shipping Tauri the toggle is a NO-OP** — the plugin is
  registered (`lib.rs:34-37`) but `launch_at_login` is never wired to `enable()`/`disable()`,
  so the UI toggle writes config JSON and nothing happens. This ticket makes it actually work
  (do not expect parity against Rust here). **(metis C5) There is NO autostart command — it's
  a startup side-effect of config. Wire it in TWO places: (1)
  `ConfigService.ServiceStartup` reads `config.General.LaunchAtLogin` and calls
  `go-autostart.Enable()`/`Disable()`; (2) `ConfigService` config-update path detects a
  `launchAtLogin` change and calls Enable/Disable as a side-effect** — without (2) the UI
  toggle persists to JSON but never registers the LaunchAgent. *Verify (metis M6 — not a
  login cycle):* after Enable, `ls ~/Library/LaunchAgents | grep claude` shows the plist and
  `launchctl list | grep claude-devtools` shows an entry; after Disable, both are gone.
- **W7-T6 Full smoke test** — every screen renders; every event fires (file-change refresh,
  SSH connect sequence, notification new/click, todo change). **`grep -rn '@tauri-apps'
  frontend/src` MUST be empty.** *Verify:* smoke checklist green; grep empty.

Exit (week-07): dialogs/opener/window/version/autostart functional via v3; **zero
`@tauri-apps` imports**; smoke test passes.

## Phase W8 — Tauri purge, validation, stabilization

Goal: remove all Tauri/Rust artifacts; full regression + parity green; no leaks; signed
builds. **This is the irreversible week.** **(metis M2) Execute T2 BEFORE T1** — run the full
regression on the pre-purge tree and get it green first, THEN delete; the phase is numbered
T1→T2 for narrative but the commit order is regression-green commit, then purge commit.

- **W8-T2 Regression suite (RUN FIRST)** — frontend `cd frontend && bun run test` + `bun run
  typecheck`; Go `go test ./...` + the **parity harness one final time** on all golden;
  manual regression of high-risk surfaces (SSH connect/retry/disconnect, snapshots
  create/open, notifications+triggers, config persistence, autostart, file-watch refresh).
  This runs on the **pre-purge** tree (both stacks present) so a regression isn't masked by
  the delete. *Verify:* all green; parity diff-clean. **Gate: do not start T1 until this is green.**
- **W8-T1 Purge Tauri (only after T2 green)** — delete `src-tauri/` (Rust backend,
  `tauri.conf.json`, `Cargo.{toml,lock}`, `icons/` after migrating to `build/`); strip
  `@tauri-apps/*` + `tauri dev|build` scripts from `package.json`; **delete
  `frontend/src/shared/types/api/tauriGlobals.ts` (metis H3 — holds `__TAURI_INTERNALS__`; it
  trips the `grep -rn 'tauri'` gate even after `@tauri-apps` imports are gone)**; consolidate
  the live frontend under `frontend/src/` and delete the dormant root `src/` tree **only
  after confirming it's unreferenced**; update root `CLAUDE.md`, delete `src-tauri/CLAUDE.md`,
  rewrite `src/CLAUDE.md` + path-alias docs for the Go/Wails layout. **Stage explicit
  deletes**; commit as one reviewable "purge" commit. *Verify:* `grep -rn 'tauri' .
  --include='*.ts' --include='*.tsx' --include='*.json'` → only historical/doc refs; repo
  builds clean.
- **W8-T3 Leak & profiling** — goroutine leaks (`runtime.NumGoroutine()` returns to baseline
  after open/close many sessions + SSH conns; every spawned goroutine + watcher channel has
  a termination path); listener leaks (every `Events.On` cleanup runs on unmount —
  mount/unmount chat views in a loop); WebView memory (long open/close loop, no unbounded
  growth). *Verify:* goroutine + listener counts stable across the stress loop.
- **W8-T4 Binary optimization & packaging** — `wails3 build -ldflags="-s -w"` (UPX only if
  the size win justifies slower cold start — test it). Expect a **larger** binary than Tauri
  (Go runtime vs system WebView) — set expectations. Configure **CSP via the v3 AssetServer**
  (Tauri's `tauri.conf.json` CSP does **not** carry over — verify SSH WS + local asset
  loading still work after the move). Produce macOS `.app`/`.dmg` (+ Windows NSIS / Linux
  deb/AppImage if targeted); re-establish **code signing / notarization** (differs from
  Tauri's tooling — budget time). *Verify:* signed artifacts launch on a clean machine.
  **(metis L3) UPX on macOS arm64 is fragile with Go binaries — if used, the verify must
  LAUNCH the compressed binary on a clean machine, not just check its size; keep UPX opt-in.**

Exit (week-08): no Tauri/Rust artifacts; repo builds + tests green; parity green; manual
regression passes; no goroutine/listener/memory leaks; optimized signed builds for targets.

## Verification strategy

- **Per ticket:** `go build ./...` + `go test ./...` green; commit (explicit paths).
- **Parity stays the spine through W5:** any `analysis/analytics` port re-runs
  `go test ./internal/paritytest/...`; the off-gate modules (analytics, tool_linking, real
  tokenizer, summarizer) get **their own** golden fixtures captured from the Rust app
  *before* porting (they aren't in the CLI-stubbed gate).
- **W6–7 are behavioral, not byte-parity:** the gate is the manual smoke checklist +
  `grep @tauri-apps = empty`. Build the smoke checklist as a committed doc so W8 can re-run it.
- **W8 is the regression + leak + packaging gate.** Run W8-T2 green **before** W8-T1 deletes.

## Risks (docs + recon)

1. **Inventory drift → "done" that isn't.** T1–T8 under-enumerate the 118 commands; the
   FilesService/summarizer/plugins/nl_query/timing/window_bus/incremental/tool_linking
   commands are easy to miss. **W5-T0 `_command-inventory.md` is the mitigation** — 118/118
   or not done.
2. **Real tokenizer divergence (now in-scope).** tiktoken-go vs tiktoken-rs special-token
   handling can differ; gate against the P1 50-string corpus before trusting analytics.
3. **Config corruption.** Non-atomic writes lose user data → temp-file + `os.Rename` only;
   test a kill-mid-write.
4. **SSH lock-across-I/O.** Hold `s.mu` only for the handle swap; never across a network
   call. // ceiling: single global SSH connection → per-connection lock if multiplexed.
5. **SSH live-verify may be impossible** (no real host) — P0 decides the fallback up front,
   don't discover it at W5-T5.
6. **Snapshot format break** — existing user snapshots must still open; freeze the on-disk
   gzip format, test with a Rust-made fixture (P3).
7. **CLI security regressions** — ID/path/rate guards are a trust boundary; port verbatim
   with unit tests.
8. **`beeep` (+ untagged deps) unpinned** — pseudo-version pin, record commit.
9. **Positional args (W6) are silently wrong** — cross-check each call against the generated
   `.d.ts` signature.
10. **`e.payload` → `e.data` (W6)** — every listener callback must change shape or it reads
    `undefined`.
11. **Bindings import path** — `frontend/bindings/<gomodule>/<pkg>`, not `wailsjs/go/`; verify
    against what `wails3` generated.
12. **Editing the wrong frontend tree** — `frontend/src/...` is live; root `src/` is dormant
    Tauri. Confirm which `wails3 dev` serves before editing.
13. **v3 dialog/window API churn (W7)** — verify each builder against the pinned alpha via
    context7; the doc snippets are "confirm against pinned alpha", not gospel.
14. **`relaunch` gap (W7)** — decide re-spawn vs quit early.
15. **CSP does not carry over (W8)** — moving CSP to the v3 AssetServer can silently break
    SSH WS / local assets; verify explicitly.
16. **Irreversible purge (W8)** — run regression green *before* deleting `src-tauri/`/`src/`;
    one reviewable purge commit; confirm root `src/` unreferenced before delete.
17. **Notarization/signing differ from Tauri** — budget time; test on a clean machine.
18. **Panics crash the app** — `recover()` at every goroutine boundary; bound methods return
    `error`.
19. **Map iteration order** — `tool_linking`/analytics serialized HashMaps; sort keys / use
    ordered slices where Rust relied on order.

## Open decisions (RESOLVED at approval, 2026-06-20)

- **D-SSH (P0): RESOLVED — no real host.** W5-T5 unit-tests the `ssh-status` sequence +
  retry + known-hosts; **live connect/disconnect verify is manual-deferred to W8.**
- **D-relaunch (W7-T4): RESOLVED — replace with `Application.Quit()`.** Drop true relaunch
  (single-user devtool; YAGNI); wherever Tauri `relaunch` was used, quit instead.
- **D-multiselect (W7-T1):** decide during W7 via context7 against the pinned alpha;
  single-folder is the accepted fallback.
- **D-targets (W8-T4): RESOLVED — ship all three:** macOS `.app`/`.dmg` (+ notarization),
  Windows NSIS (+ signing cert), Linux deb/AppImage.
- **D-cadence: RESOLVED — execute W5 now, commit per ticket on `feat/wails-migration`,
  each phase committed via `/caveman-commit`.** Long sequential effort; report at ticket
  boundaries.

## Review Trail

### Metis Plan Consultant
- [x] **C1** Command count is **118**, not 119 (`get_app_version` is entry 1 of the 118) — fixed everywhere; gate now reads 118/118.
- [x] **C2** `cache.rs` (465 LOC, LRU+TTL+byte-budget+`IncrementalState`) was unported and is a compile-time prerequisite → added **W5-T0.5** cache ticket before T1.
- [x] **C3** Over-loaded W5-T8 split into **T8a** (incremental reader + summarizer) / **T8b** (Files/Search/Timing/System + bind).
- [x] **C4** `get_model_comparison` (`analytics/model_comparison.rs`) was omitted → added to W5-T2 command list.
- [x] **C5** Autostart has no command (Tauri startup side-effect) → W7-T5 now wires it in two places (`ServiceStartup` + config-update side-effect).
- [x] **H1** Discovery/group commands (`context_*`, `get_*_groups`, `get_worktree_sessions`, `get_waterfall_data`) are hardcoded stubs → port verbatim, no real registry.
- [x] **H2** Config command count is exactly **40** (week-05's "45" miscounts) → W5-T3 corrected.
- [x] **H3** `frontend/src/shared/types/api/tauriGlobals.ts` (`__TAURI_INTERNALS__`) trips the purge grep → explicit delete in W8-T1.
- [x] **H4** Rust holds `tokio::Mutex` across `.await` (`ssh/commands.rs:15,39,86`) → W5-T5 forbids replicating; added concurrent Connect+GetState no-deadlock test.
- [x] **H5** Incremental reader 4-way cache branch (`commands/sessions.rs:216-274`) → W5-T8a gets a concrete byte-offset-skip test.
- [x] **M2** W8 reordered: run regression (T2) green **before** purge (T1).
- [x] **M3** `config_open_in_editor` → W5-T3 note (later corrected by momus FIX1: it uses `tauri_plugin_opener` on a fixed path, not os/exec, no injection surface).
- [x] **M4** `context_*` are stubs (`agents_search/context.rs`), no state → removed `sync.RWMutex` from T0 table.
- [x] **M5** `session_scan` is a helper, not a command → reclassified in W5-T2.
- [x] **M6** Autostart verify uses `launchctl`/`ls ~/Library/LaunchAgents`, not a login cycle.
- [x] **M1/L1/L3/L4** folded: W6-T5 grep-after note; `window_bus` is single-app broadcast (no multi-window); UPX must launch-test; `notifications_test_trigger` imports from `notificationservice`.
- [x] **L2** (noted) CLI guards: confirm Go CLI never reads `CLAUDE_HOME`/`HOME` (covered by W5-T7 verbatim-guard + unit test).

### Architect Reviewer
- [x] **C1** Shared `SessionCache` had no owner/injection (v3 has no DI; `lib.rs:41` shares one `Arc<Mutex>` across 5 services) → W5-T0.5 now mandates one instance built in `main.go`, pointer-injected into the 5 services; cache owns its lock; no service imports another service.
- [x] **H1** Cache layering pinned: `domain ← parsing ← {cache, pipeline} ← services`; `cache` imports only `domain`+`parsing` (`cache.rs:9-10`); the 4-way orchestration is SessionService-layer, not `pipeline`; import-check test extended.
- [x] **H2** Resolved the W5-T1-vs-week-05 contradiction: `SubprojectRegistry` IS real shared state (`subproject_registry.rs:18`) → single-instance injection like the cache; only the `context_*`/group **commands** are stubs.
- [x] **M1** W7-T5 relabeled a **behavior fix, not a port** — autostart toggle is a no-op in shipping Tauri (`lib.rs:34-37` never wires `launch_at_login`).
- [x] **M2** Bindings module path corrected to hyphenated **`claude-devtools`** (verified `frontend/bindings/claude-devtools/`), not the week-06 `claudedevtools` literal.
- [x] **M3** W6 path resolved to the live `frontend/src/renderer/...`; dormant root `src/` `@tauri-apps` imports expected until W8-T1, grep gate scoped to `frontend/src`.
- [x] **L1** Off-gate golden artifacts named (`golden/tokenizer-corpus.json`, `golden/analytics/`, summarizer fixture) in P1, mirroring W2's `golden/`.
- [x] **L2** (noted) README:18 "native multi-window" aspiration is superseded by the single-app-broadcast `window_bus` decision.
- [x] **Confirmed SOUND (no churn):** downward-only package graph; W8 regression-before-purge ordering; W5→W6→W7→W8 sequencing (bindings precede frontend calls; ConfigService exists before W7 dialog); SSH lock model + no-deadlock test; config atomic persist + editor sandbox; incremental 4-way state machine split; 118/118 inventory contract; YAGNI restraint maintained.

### Momus Plan Reviewer
- [x] **Verdict: GO** (after fixes). 27/30 spot-checked `file:line`/symbol/count claims PASS, incl. the gate-critical ones: 118 commands (`lib.rs:58-175`, `get_app_version` = entry 1), 40 `config::commands::*`, all 7 W5 LOC values exact, cache internals (`cache.rs:35` `IncrementalState`+`byte_offset`, `:9-10` imports), SSH `tokio::Mutex`-across-`.await` (`ssh/commands.rs:15,39,86`), `subproject_registry.rs:18` real state, `context.rs` stubs, autostart no-op (`lib.rs:34-37`, zero `.enable()`), 6 `@tauri-apps` importers, `tauriGlobals.ts` exists.
- [x] **All 118 commands reconciled to exactly one ticket — zero orphaned, zero double-owned.**
- [x] **FIX1 (applied):** `config_open_in_editor` does NOT use os/exec and takes no path arg — it opens the fixed `state.get_config_path()` via `tauri_plugin_opener` (`config/commands.rs:211-221`). Removed the false "reject arbitrary path" sandbox/verify (metis M3 premise was wrong); reworded to fixed-path open. Cite corrected `:213`→`:211`.
- [x] **FIX2 (applied):** incremental branch range `216-274`→`216-293` (match block 233-293); "4-way" reworded to the actual delta-append-vs-full-parse + empty-delta short-circuit.
- [x] **FIX3 (applied):** bindings path corrected to `frontend/bindings/claude-devtools/internal/<svc>service` (verified generated depth includes the `internal/` segment).
- [x] Executability confirmed: SSH P0 fallbacks make W5-T5 runnable without a live host; autostart verify uses `launchctl`/`ls` (no login cycle); W8 T2-before-T1 stated consistently.

---

**Plan status: APPROVED for execution** (metis ✓ · architect-reviewer ✓ · momus GO ✓).
