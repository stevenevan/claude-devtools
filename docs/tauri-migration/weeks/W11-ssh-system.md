# W11 — SSH + system   ·   Cycle C: Secondary services

## Goal
Port SSH remote-mode + the system service so the SSH connection state machine and openPath/version behave identically to Go.

## Scope
SSH + system. `ssh` + `sshservice` (remote mode, connection state gate), `systemservice` (`OpenPath`, `GetAppVersion`).

## Packages / files to port
- `internal/ssh` + `internal/sshservice` → remote mode, connection state gate (`connectionMode === 'local'` drives the frontend `canAct` dual-gate, invariant #3).
- `internal/systemservice` → `OpenPath`, `GetAppVersion`.

## ⚠️ Cross-week coupling (verified)
`internal/systemservice` embeds a `watcher.Runner` and calls `watcher.New` / `watcher.ResolveClaudeDir` — from `internal/watcher` (**W10**). W10 precedes W11 so order is safe; the W10 watcher API must be in place before wiring `systemservice`.

## Parity check
SSH state machine parity; openPath/version behave identically.

## Invariants in force
- Always: #1, #2, #5, #6.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W07 (session backend), W10 (`internal/watcher` — see coupling note).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend + adapter) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
