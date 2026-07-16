# W13 — Maintenance engine   ·   Cycle D: Config & maintenance write spine

## Goal
Port the maintenance engine — category matchers, trash-based deletion, retention policy, scheduler — with dry-run candidate sets and trash receipts matching Go, and mutations SSH-gated.

## Scope
Maintenance engine. `maintenance` + `maintenanceservice`: category matchers, `TrashItems`, plain-delete primitive, retention `RunPolicy`, scheduler, SSH-gate.

## Packages / files to port
- `internal/maintenance` → category matchers, `TrashItems` (never hard-delete user data, invariant #3), plain-delete primitive, retention `RunPolicy`, scheduler.
- `internal/maintenanceservice` → the service wrapper; SSH-gate on mutations.

## ⚠️ Cross-week coupling (verified) — carve-out
`internal/maintenanceservice/configbackup.go` defines `MaintenanceService.CaptureConfig`, `.ListConfigBackups`, `.RestoreConfig`, each calling into `internal/configbackup` — which is **W14's package**. **Defer these three methods to W14.** Port only the maintenance-engine methods this week; leave the config-backup trio for W14 so neither week duplicates or half-owns them.

## Parity check
Dry-run reports identical candidate sets/bytes; trash receipts match; scheduler gated.

## Invariants in force
- Always: #1, #2, #5, #6.
- **#3 write-safety spine** — `TrashItems` never hard-deletes user data; SSH-gate on mutations; watcher-mute during writes.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W12 (files write spine).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend + adapter) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
