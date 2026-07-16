# W05 — Analysis engine   ·   Cycle B: Core read pipeline

## Goal
Port the largest package — the analysis engine — so Rust builds identical chunk trees + metrics to Go for every fixture session.

## Scope
Analysis engine (largest port). `internal/analysis`: chunk_builder state machine, chunk_factory (`EnhancedChunk[]`), tool_execution_builder, semantic_step_extractor, context_accumulator.

## Packages / files to port
- `internal/analysis` →
  - chunk_builder — the state machine that flushes the AI buffer on non-AI messages.
  - chunk_factory → `EnhancedChunk[]` (User / AI / System / Compact / Event chunk types).
  - tool_execution_builder, semantic_step_extractor, context_accumulator.

## Parity check
Identical chunk trees + metrics vs Go for every fixture session.

## Invariants in force
- Always: #1, #2, #5, #6.
- Architect review advised (per the mega-prompt) — this week reshapes the core data-flow boundary.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W04 (`ParsedMessage[]` is the input).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
