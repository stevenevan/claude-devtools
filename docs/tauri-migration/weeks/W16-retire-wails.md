# W16 — Retire Wails + rebuild toolchain   ·   Cycle E: Cutover & retire

## Goal
Delete the Go/Wails backend and its toolchain, port build/packaging to Tauri, and leave a clean Tauri-only build with all gates green and no Wails references.

## Scope
Retire Wails + rebuild toolchain. Delete Go backend, Wails deps, `@wailsio/runtime`, generated bindings; port build/packaging; rewrite `CLAUDE.md` data-pipeline section; flesh out `docs/tauri-migration/` with the completed record.

## Packages / files to port / delete
- Delete: Go backend (`internal/`, `main.go`, the `cmd/cli` Go side), Wails deps, `@wailsio/runtime`, generated bindings (`frontend/bindings/`).
- Port build/packaging: macOS `.app` bundle + adhoc codesign, `Taskfile`, `bin/` → Tauri equivalents.
- Rewrite the `CLAUDE.md` data-pipeline section (drop the stale Tauri-heritage note).
- Flesh out `docs/tauri-migration/` beside `migration-prompt.md` with the completed record.

## Parity check
Clean Tauri-only build; `cargo test` + `bun test` + `tsc` green; no Go/Wails references remain.

## Invariants in force
- #6 commit-per-week-explicit-paths. (Invariants #1–#4 retire with the Go backend and the dual-mode flag; #5 no-dep-drift still applies to the source commit.)
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W15 (Tauri must be the default and whole-surface green before deleting Go).

## Per-week loop
`/plan-with-review` scoped to this week → implement (delete Go/Wails, port toolchain, rewrite docs) → **final week: the Go backend is deleted, not kept** → run gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
