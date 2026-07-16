# W07 — Session + search commands   ·   Cycle B: Core read pipeline

## Goal
Wire the first end-to-end Tauri commands + the `cmd/cli` Rust twin so a session loads in-app via the Tauri backend and the CLI JSON diff goes green.

## Scope
Session + search commands. `sessionservice`, `searchservice`, `internal/search`, `internal/pipeline`; wire first Tauri commands + `cmd/cli` Rust twin.

## Packages / files to port
- `internal/sessionservice` → Tauri commands for session detail (the first real IPC commands, satisfying the frozen `WailsAPI` session methods).
- `internal/searchservice` + `internal/search` → search commands.
- `internal/pipeline` → the orchestration that assembles `SessionDetail { chunks, metrics, processes }`.
- `cmd/cli` (`cmd/cli/main.go`) → begin the Rust CLI twin emitting `show-session --format json` identically — the parity oracle.

## Parity check
**First end-to-end**: CLI JSON diff green; load a session in-app via the Tauri backend, timeline matches.

## Invariants in force
- Always: #1 (first live use of the oracle), #2, #5, #6.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W05 (chunk trees), W06 (discovery + cache).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend + first Tauri commands + adapter) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
