# W12 — Config service + files spine   ·   Cycle D: Config & maintenance write spine

## Goal
Port the config service and the `internal/files` write-safety spine — read-only inspectors first, then writes that produce identical bytes + `.bak` to Go.

## Scope
Config service + files spine. `configservice`, `internal/files` incl. the write-safety spine (mutex, atomic temp+rename, `.bak`, confinement, secret masking); read-only inspectors first.

## Packages / files to port
- `internal/configservice` → config commands.
- `internal/files` → the **write-safety spine** (invariant #3): per-family mutex, read-fresh-under-lock, atomic temp+rename, `.bak` backups, parent-path (never leaf) confinement, secret masking. Port read-only inspectors first, then the write path.

## ⚠️ Cross-week coupling (verified)
`filesservice.AnalyzePermissionSuggestions` returns `permissions_analyzer.AnalyzeUsage(root)` from `internal/insights/permissions_analyzer` (**W09**). W09 precedes W12 so order is safe; that analyzer must already be ported.

## Parity check
Masked reads identical; write produces same file bytes + `.bak` as Go.

## Invariants in force
- Always: #1, #2, #5, #6.
- **#3 write-safety spine** — reproduce every guard; a migration is not a place to "simplify" a safety check.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W07 (session backend). Couples to `internal/insights/permissions_analyzer` (W09) — see coupling note.

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend + adapter) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
