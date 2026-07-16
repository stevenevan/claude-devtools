# W09 — Insights + snapshots   ·   Cycle C: Secondary services

## Goal
Port the insights engine (incl. permissions analysis) and snapshots so insight outputs and snapshot capture/restore match Go.

## Scope
Insights + snapshots. `internal/insights` (incl. `permissions_analyzer`), `internal/snapshots` + `snapshotservice`.

## Packages / files to port
- `internal/insights` → error hotspots, tool analytics, tool linking, file graph, etc.
- `internal/insights/permissions_analyzer` → backs `filesservice.AnalyzePermissionSuggestions` (via `permissions_analyzer.AnalyzeUsage`), consumed at W12.
- `internal/snapshots` + `internal/snapshotservice` → snapshot capture / restore.

## ⚠️ Cross-week coupling (verified)
The `internal/insights` functions here also back W08's `analyticsservice` methods (`GetErrorHotspots`, `GetToolAnalytics`, `GetToolTimeHeatmap`, `GetErrorClusters`). If W08 deferred those methods' parity, **close it here.**

## Parity check
Snapshot capture/restore + insight outputs match.

## Invariants in force
- Always: #1, #2, #5, #6.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W07 (session / pipeline).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend + adapter) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
