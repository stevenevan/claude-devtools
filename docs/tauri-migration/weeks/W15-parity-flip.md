# W15 — Full parity sweep + flip   ·   Cycle E: Cutover & retire

## Goal
Complete the CLI twin, sweep the whole ~213-method surface for parity, flip the frontend default to Tauri, and delete the dual-mode flag.

## Scope
Full parity sweep + flip. Complete `cmd/cli` Rust twin; run the ~213-method parity sweep across all services; flip frontend default to Tauri; delete the dual-mode flag.

## Packages / files to port
- Complete the `cmd/cli` Rust twin (all `show-session` surfaces).
- Run the ~213-method parity sweep across all 11 services (CLI JSON diff for reads; before/after state assertions for writes).
- `frontend/src/renderer/api/index.ts` → flip default factory to `createTauriClient()`; **delete the dual-mode flag** (invariant #4 dies here).

## Parity check
Whole-surface parity green; app runs on Tauri by default.

## Invariants in force
- Always: #1 (final full sweep), #2, #5, #6.
- **#4 dual-mode: the flag is removed this week.** (Go backend still kept runnable until W16.)
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W01–W14 (entire surface must be ported).

## Per-week loop
`/plan-with-review` scoped to this week → implement (parity sweep + frontend flip) → keep the Go backend runnable until W16 → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
