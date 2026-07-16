# W14 — Backup + notifications   ·   Cycle D: Config & maintenance write spine

## Goal
Port config backup export/import (with the trust gate) and notifications so importing a fixture archive yields an identical on-disk result including disarmed hooks.

## Scope
Backup + notifications. `internal/configbackup` (export/import trust gate — zip-slip guard, byte caps, `hooks`-strip → `hooks-disabled.json`), `notifications` + `notifyservice`.

## Packages / files to port
- `internal/configbackup` → export/import with the **trust gate** (invariant #3): zip-slip guard, byte caps, `hooks`-strip → `hooks-disabled.json` (disarm hooks on import).
- Wire the three `MaintenanceService.CaptureConfig` / `.ListConfigBackups` / `.RestoreConfig` methods **deferred from W13** (they call into this package).
- `internal/notifications` + `internal/notifyservice` → notification triggers / delivery.

## Parity check
Import of a fixture archive yields identical on-disk result incl. disarmed hooks.

## Invariants in force
- Always: #1, #2, #5, #6.
- **#3 write-safety spine** — zip-slip guard, byte caps, hooks disarmed on import; `TrashItems` for anything destructive.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W12 (files spine), W13 (`MaintenanceService` config-backup methods deferred here).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend + adapter) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
