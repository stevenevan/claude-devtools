# W08 — Analytics + timing   ·   Cycle C: Secondary services

## Goal
Port analytics/timing services + the tokenizer so their payloads match Go for the fixtures — with token counts confirmed against Go before wiring.

## Scope
Analytics + timing. `internal/analytics` + `analyticsservice`, `timingservice`, `internal/tokenizer`.

## Packages / files to port
- `internal/analytics` + `internal/analyticsservice` → analytics payloads.
- `internal/timingservice` → timing payloads.
- `internal/tokenizer` → Rust token counter (see premise gate).

## ⚠️ Cross-week coupling (verified against the import graph)
`internal/analyticsservice` hosts `GetErrorHotspots`, `GetToolAnalytics`, `GetToolTimeHeatmap`, `GetErrorClusters` as thin wrappers over `internal/insights/*` — which is scheduled at **W09 (after this week)**. Options: (a) port the specific `internal/insights` functions these four methods call *alongside* W08, or (b) defer those four methods' parity to W09 and note it in this week's parity report. Do not silently ship `analyticsservice` as "done" while these methods are stubbed. (The mega-prompt's W08-before-W09 ordering has this backward edge — flagged to the user; may be resolved by swapping W08/W09.)

## Parity check
Analytics/timing payloads match Go for fixtures.

## Invariants in force
- Always: #1, #2, #5, #6.
(full text: see migration-prompt.md "Invariants")

## Premise gate — RESOLVE BEFORE WIRING
**A Rust tokenizer matches `internal/tokenizer` counts.** Impact if wrong: W08 token metrics drift from Go. Check: diff the chosen Rust tokenizer against Go on fixtures *before* wiring.

## Depends on
W07 (session / pipeline). Couples to `internal/insights` (W09) — see the coupling note above.

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend + adapter) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
