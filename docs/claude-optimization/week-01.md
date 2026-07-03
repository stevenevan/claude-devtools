# Week 1 — Storage Scan Service + Maintenance View Skeleton

**Objective:** Ship a read-only storage dashboard: a `du`-style per-directory table of the
user's `~/.claude` tree (2.9 GB at audit time) plus the app's own `~/.claude-devtools`
footprint, behind a new `maintenance` ActivityBar view. This week also unifies root
resolution — the foundation every later cleanup/config week builds on.

**Prerequisites:** none (first week of the program). Existing code to build on:
- `internal/config/manager.go:127` — `GetClaudeRootInfo()` with `EffectivePath` (the ONLY
  sanctioned root resolver)
- `internal/files/pathutil.go:332` — `claudeDir()` (hardcoded home; to be routed through the
  resolver, not duplicated)
- `internal/snapshots/snapshots.go:47` — existing `~/.claude-devtools/snapshots/` owner
- `internal/filesservice/service.go` — service wrapper pattern
- `frontend/src/renderer/store/slices/uiSlice.ts:4` — `ActivityView` union

## Tickets

### W1-T1 — Root + appdata resolvers (single source of truth)
- All maintenance targets resolve through the configured effective root
  (`GetClaudeRootInfo().EffectivePath`), never a hardcoded `os.UserHomeDir()/.claude`.
  The split between `files.claudeDir()` and config's resolver already exists — `internal/maintenance`
  must not add a third variant.
- Extract a shared appdata resolver for `~/.claude-devtools/` (today re-derived inside
  `internal/snapshots/snapshots.go`); `snapshots/`, and later `trash/` + `config-backups/`
  (weeks 2, 24), are subdirs of it.
- Verify: unit test — with a non-default configured root, scan targets that root, not `$HOME/.claude`.

### W1-T2 — `internal/maintenance` package: scanners
- New pure-logic package (no `application.Get()`, mirroring `internal/watcher`'s layering):
  - `ScanClaudeDir(ctx context.Context) ([]DirUsage, error)` — recursive walk of the
    effective root AND the appdata dir.
    `type DirUsage struct { Path string; Bytes int64; Files int; ModTime time.Time; IsSymlink bool; Err string }`
  - `Bytes` is recursive for directories. `Lstat`-based: symlinks are flagged
    (`IsSymlink: true`) and NEVER traversed — no double-count, no escape outside the root,
    no cycles. Per-entry walk errors land in `Err` (permission-denied dirs must not vanish silently).
  - `ScanCategory(ctx context.Context, spec CategorySpec) ([]Candidate, error)` — matcher
    framework later weeks feed (stale-by-age, duplicate binaries, empty dirs, …). This week
    ships the type + one trivial spec (top-level dirs by size) to prove the shape.
- Honor `ctx` cancellation mid-walk; return partial results with an explicit error.
- Verify: `go test ./internal/maintenance/...` — fixture tree with a symlink cycle and an
  unreadable dir scans clean, flags both, follows neither.

### W1-T3 — `maintenanceservice` binding with progress events
- New `internal/maintenanceservice/service.go`, struct `MaintenanceService` — wrapper per
  command, but NOT purely thin: holds an injected `emitFn func(event string, payload any)`
  wired in `main.go` (mirrors how `systemservice` wires `watcher.Runner`).
- Emits `maintenance:scan-progress` during walks (dirs visited, bytes so far) so a multi-GB
  scan never freezes the UI; exposes a cancel command.
- Register the service in `main.go`; `wails3 generate bindings -ts`; add wrappers to the
  hand-maintained `frontend/src/renderer/api/domain/` + `@shared/types/api` files (bindings
  regen alone is not enough — precedent: the existing settings editor wiring).
- Verify: `go build ./...`; bindings expose `ScanClaudeDir` + cancel; progress events arrive
  in the frontend console during a scan of a large fixture.

### W1-T4 — Maintenance view skeleton
- Extend `ActivityView` union in `uiSlice.ts` with `maintenance`; add ActivityBar button
  (`components/layout/ActivityBar.tsx`) and route in `PaneContent.tsx`.
- New `frontend/src/renderer/store/slices/maintenanceSlice.ts` (scan results, loading,
  error, progress) + view components under `frontend/src/renderer/components/maintenance/`:
  sortable per-dir table (path, size, files, last modified), symlink badge, scan/cancel
  buttons, progress bar fed by `maintenance:scan-progress`.
- The ENTIRE view is hidden when `!isDesktopMode()`. Scan action additionally gates on
  `connectionMode === 'local'` (`connectionSlice.ts`) with an explicit "operates on this
  local machine only" notice — `electronOnly`-style gating alone is insufficient because
  `isDesktopMode()` is hardcoded `true` while an SSH session is active.
- Tailwind theme classes only (`bg-surface`, `text-text-secondary`, …); `Button` component,
  no plain `<button>`; no inline `style` props.
- Verify: `bunx tsc --noEmit` green; `bun run test` green.

## Exit criteria

- [ ] `go test ./internal/maintenance/...` green, including symlink-flagging and
      cancellation tests.
- [ ] Scan of the live `~/.claude` completes and the table's total matches `du -sk` within
      rounding; symlinked entries carry `IsSymlink: true` (counts come from live
      `ScanClaudeDir` output, never hardcoded expectations).
- [ ] `maintenance:scan-progress` events observed in the frontend during a live scan; cancel
      mid-scan returns partial results without a crash.
- [ ] With a non-default configured root, the dashboard shows that root's tree (resolver test).
- [ ] The app's own appdata dir (`snapshots/` today) appears in the table — the tool is not
      blind to its own footprint.
- [ ] Maintenance view absent in browser/server build; scan disabled with local-only notice
      when `connectionMode !== 'local'`.
- [ ] `bunx tsc --noEmit`, `bun run test`, `go vet ./internal/...` green.

## Risks

- **Root resolver drift** — if any later week hardcodes `os.UserHomeDir()/.claude`, scan and
  delete can target DIFFERENT trees (scan one, trash another). This week's resolver is the
  only sanctioned path; treat any new hardcoded root in review as a blocker.
- **Blocking walks** — `projects/` alone held ~936 MB / 922 JSONL at audit; a synchronous
  walk without progress + cancel freezes the UI for seconds. Progress events and `ctx`
  cancellation are part of the contract, not polish.
- **Symlink traversal** — following links inflates sizes, loops, and walks outside
  `~/.claude` (skill dirs are symlinked to real repos elsewhere). `Lstat`-only is mandatory.
- **Scope creep into deletion** — this week is strictly read-only; the delete engine is
  week 2. Shipping even one "quick delete button" now bypasses every safety invariant the
  trash engine defines.
