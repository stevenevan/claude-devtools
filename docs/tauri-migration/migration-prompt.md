# Wails v3 → Tauri 2.x Migration — 16-Week Sprint Prompt

Hand this file to Claude Code as the governing directive. It reverses the original Tauri→Wails
migration: port the ~41k-LOC Go backend (`internal/`, 11 service wrappers, ~213 exported methods)
to a Rust/Tauri backend, while the ~61k-LOC React frontend stays put behind its existing
`WailsAPI` interface (`@shared/types/api`).

---

## Governing directive (paste as the `/goal`)

> Migrate this app from Wails v3 (Go) to Tauri 2.x (Rust) across 16 sprint weeks. Each week: run
> `/plan-with-review` for that week's scope, then implement, then commit that week separately with
> explicit git paths. Weeks are ordered bottom-up so each one ships a testable slice gated by the
> parity oracle. If you can group adjacent weeks without collating unrelated scope, group them; if
> the total exceeds 3 cycles, work on the first three cycles only.
>
> Models — Main: opus 4.8 xhigh; Metis: sonnet 5 xhigh; Momus: opus 4.8 xhigh; backend (Rust) and
> frontend implementation: opus 4.8 xhigh; docs: sonnet 5.

## Why this is tractable (grounded in the current tree)

- **The frontend seam is already clean.** Only ~7 files import Wails bindings, 3 import
  `@wailsio/runtime`, and there are ~10 `Events.On` calls — all concentrated in six adapters under
  `frontend/src/renderer/api/domain/` (`analytics.ts`, `config.ts`, `files.ts`, `maintenance.ts`,
  `sessions.ts`, `system.ts`). Everything else in the frontend calls the stable `WailsAPI`
  interface (`@shared/types/api`). Swapping adapters is the whole frontend cost.
- **The seam is a single factory.** `createWailsClient()` in
  `frontend/src/renderer/api/wailsClient.ts` spreads the six adapters into one `WailsAPI`;
  `api/index.ts` exposes it through a Proxy (`initializeApi()` / `getImpl()`). The migration adds a
  parallel `createTauriClient()` returning the *same* `WailsAPI`, and `api/index.ts` chooses which
  factory to call — that one file is the entire dual-mode switch. (`isDesktopMode()` is hardcoded
  `true`; the `canAct` gate below still guards writes.)
- **A parity oracle already exists.** `cmd/cli` emits deterministic `show-session --format json`.
  The Go backend is the reference implementation; the Rust port must match its JSON byte-for-byte.
  Build the Rust CLI in lockstep and diff the two on a fixture corpus of real sessions.
- **`dist-standalone/` is frontend-only** (a bundled `index.cjs` + demo media); the backend port
  does not touch it.

## Invariants (hold for every week)

1. **Parity gate is the oracle.** No week is "done" until the Go and Rust backends produce
   identical output for the surface that week touches (CLI JSON diff for read paths; explicit
   before/after state assertions for write paths). Keep both backends runnable until W16.
2. **Interface stays frozen.** `WailsAPI` / `@shared/types/api` do not change shape. Rust
   commands + Tauri events must satisfy the exact same contract the Wails bindings do.
3. **Preserve the write-safety spine when porting it (W12–W14).** Per-family mutex, read-fresh-
   under-lock, atomic temp+rename, `.bak` backups, `TrashItems` (never hard delete) for user data,
   SSH-gate on maintenance mutations, watcher-mute during writes, parent-path (never leaf)
   confinement, frontend dual-gate `canAct = isDesktopMode() && connectionMode === 'local'`. The
   Rust port reproduces each guard — a migration is not a place to "simplify" a safety check.
4. **Dual-mode until cutover.** `api/index.ts` picks the backend by calling `createWailsClient()`
   or `createTauriClient()` behind a build/env flag, so every week is shippable and A/B-testable
   against parity. The flag dies in W15.
5. **No dependency drift in source commits.** Lockfile / icon / generated-binding churn is reverted
   before committing week source, exactly as the optimization sprints did.
6. **Commit per week, explicit paths, never `git add -A`.**

---

## The 16 weeks

Ordered as five cycles. Each row names the real packages/files it ports and its parity check.

### Cycle A — Scaffold & seam (W1–W2)

| Wk | Scope | Ports / touches | Parity check |
|----|-------|-----------------|--------------|
| **W1** | Tauri 2.x scaffold beside Wails | new `src-tauri/` (Rust workspace, `tauri.conf.json`, `Cargo.toml`), window config reproducing the transparent titlebar + traffic lights from `main.go` (`AppearsTransparent`, `InvisibleTitleBarHeight: 40`, 1400×900 / min 900×600); Vite wiring for `beforeDevCommand`/`frontendDist` | Empty Tauri shell boots to the same window chrome; Wails build still works |
| **W2** | IPC + event seam | add `createTauriClient()` (`tauriClient.ts`) beside `createWailsClient()`; `api/index.ts` selects one by flag; event bridge Wails `Events.On` → Tauri `listen`; freeze `WailsAPI` as the parity contract | Frontend runs against Wails unchanged with the switch inserted; zero component diffs |

### Cycle B — Core read pipeline (W3–W7) — the heart of the app

| Wk | Scope | Ports / touches | Parity check |
|----|-------|-----------------|--------------|
| **W3** | Domain + config foundation | `internal/domain` DTOs → serde structs matching `@shared/types`; `internal/config` (root resolution, `~/.claude` paths, path encoding); `internal/ptr` | Rust config resolves same effective root; serde round-trips a fixture DTO |
| **W4** | Parsing + classification | `internal/parsing` (streaming JSONL → `ParsedMessage`, large-buffer `bufio` equiv) + classifier (`HardNoise\|User\|Ai\|System\|Event\|Compact`) | Rust parser + Go parser emit identical `ParsedMessage[]` on the fixture corpus |
| **W5** | Analysis engine (largest port) | `internal/analysis`: chunk_builder state machine, chunk_factory (`EnhancedChunk[]`), tool_execution_builder, semantic_step_extractor, context_accumulator | Identical chunk trees + metrics vs Go for every fixture session |
| **W6** | Discovery + cache | `internal/discovery` (project scan, path decode), `internal/cache` (LRU + byte-offset incremental detail) | Same project/session enumeration; incremental re-parse skips same bytes |
| **W7** | Session + search commands | `sessionservice`, `searchservice`, `internal/search`, `internal/pipeline`; wire first Tauri commands + `cmd/cli` Rust twin | **First end-to-end**: CLI JSON diff green; load a session in-app via Tauri backend, timeline matches |

### Cycle C — Secondary services (W8–W11)

| Wk | Scope | Ports / touches | Parity check |
|----|-------|-----------------|--------------|
| **W8** | Analytics + timing | `internal/analytics` + `analyticsservice`, `timingservice`, `internal/tokenizer` | Analytics/timing payloads match Go for fixtures |
| **W9** | Insights + snapshots | `internal/insights` (incl. `permissions_analyzer`), `internal/snapshots` + `snapshotservice` | Snapshot capture/restore + insight outputs match |
| **W10** | File watcher | `internal/watcher` → Rust (`notify` crate), 100ms debounce, recursive, mute API; emit change events over the Tauri bridge | Same debounced `FileChangeEvent`s reach the frontend on edits |
| **W11** | SSH + system | `ssh` + `sshservice` (remote mode, connection state gate), `systemservice` (`OpenPath`, `GetAppVersion`) | SSH state machine parity; openPath/version behave identically |

### Cycle D — Config & maintenance write spine (W12–W14) — the destructive surface

| Wk | Scope | Ports / touches | Parity check |
|----|-------|-----------------|--------------|
| **W12** | Config service + files spine | `configservice`, `internal/files` incl. the write-safety spine (mutex, atomic temp+rename, `.bak`, confinement, secret masking); read-only inspectors first | Masked reads identical; write produces same file bytes + `.bak` as Go |
| **W13** | Maintenance engine | `maintenance` + `maintenanceservice`: category matchers, `TrashItems`, plain-delete primitive, retention `RunPolicy`, scheduler, SSH-gate | Dry-run reports identical candidate sets/bytes; trash receipts match; scheduler gated |
| **W14** | Backup + notifications | `internal/configbackup` (export/import trust gate — zip-slip guard, byte caps, `hooks`-strip → `hooks-disabled.json`), `notifications` + `notifyservice` | Import of a fixture archive yields identical on-disk result incl. disarmed hooks |

### Cycle E — Cutover & retire (W15–W16)

| Wk | Scope | Ports / touches | Parity check |
|----|-------|-----------------|--------------|
| **W15** | Full parity sweep + flip | complete `cmd/cli` Rust twin; run the ~213-method parity sweep across all services; flip frontend default to Tauri; delete the dual-mode flag | Whole-surface parity green; app runs on Tauri by default |
| **W16** | Retire Wails + rebuild toolchain | delete Go backend, Wails deps, `@wailsio/runtime`, generated bindings; port build/packaging (macOS `.app` bundle + adhoc codesign, `Taskfile`, `bin/`); rewrite `CLAUDE.md` data-pipeline section (drop the stale Tauri-heritage note); flesh out `docs/tauri-migration/` beside this prompt with the completed record | Clean Tauri-only build; `cargo test` + `bun test` + `tsc` green; no Go/Wails references remain |

---

## Per-week loop (same as the optimization sprints)

1. `/plan-with-review` scoped to the week → plan to `<scratchpad>/plans/<week-slug>.md`.
2. Metis → auto-sized middle reviewers (security-auditor fires on W12–W14 for sure; architect on
   any week that reshapes a boundary — W2, W5, W15) → Momus. Reviewers propose, you dispose; log a
   Review Trail; fact-checks are never rejectable.
3. Implement (Rust backend + adapter/frontend agent), keeping the Go backend runnable.
4. Run the week's parity check + the standard gates (`cargo build`/`cargo test`, `bunx tsc
   --noEmit`, `bun test`). Red → fix before committing.
5. Commit the week with explicit paths.

## Assumptions (shoot these down before W1)

- **UNVERIFIED: target is Tauri 2.x** (current major). Impact if wrong: `tauri.conf.json` schema,
  `invoke`/`listen` API, and capability/permission model differ from v1. Cheapest check: confirm
  the desired Tauri major, then verify the config + IPC API via context7 / tauri.app docs.
- **UNVERIFIED: transparent-titlebar chrome is reproducible in Tauri** the way `main.go` does it in
  Wails. Impact if wrong: W1 window styling needs a platform tweak. Cheapest check: Tauri window
  `titleBarStyle: "Overlay"` / `hiddenTitle` docs (the original Tauri build used exactly this).
- **UNVERIFIED: a Rust tokenizer matches `internal/tokenizer` counts.** Impact if wrong: W8 token
  metrics drift from Go. Cheapest check: diff the chosen Rust tokenizer against Go on fixtures in
  W8 before wiring.

Resolve each at its week's premise gate (or W1 for the Tauri-version one) — do not build a week on
an open premise.
