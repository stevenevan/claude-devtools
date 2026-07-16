# W10 — File watcher   ·   Cycle C: Secondary services

## Goal
Port the debounced recursive file watcher to Rust and emit change events over the Tauri bridge so the same `FileChangeEvent`s reach the frontend.

## Scope
File watcher. `internal/watcher` → Rust (`notify` crate), 100ms debounce, recursive, mute API; emit change events over the Tauri bridge.

## Packages / files to port
- `internal/watcher` → Rust using the `notify` crate: recursive watch of `~/.claude`, 100ms debounce (Go uses `rjeczalik/notify`), mute API (watcher-mute during writes — used by the W12–W14 write spine, invariant #3).
- Emit `FileChangeEvent`s over the Tauri event bridge established at W02 (Tauri `emit` → frontend `listen`).

## Parity check
Same debounced `FileChangeEvent`s reach the frontend on edits.

## Invariants in force
- Always: #1, #2, #5, #6.
- #4 dual-mode: events must arrive identically on the Tauri path as on the Wails path.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W02 (event bridge), W07 (session backend to refresh).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend + adapter) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
