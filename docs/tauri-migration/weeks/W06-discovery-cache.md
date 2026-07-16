# W06 — Discovery + cache   ·   Cycle B: Core read pipeline

## Goal
Port project/session discovery and the caching layer so enumeration matches Go and incremental re-parse skips the same bytes.

## Scope
Discovery + cache. `internal/discovery` project scan + path decode; `internal/cache` LRU + byte-offset incremental detail.

## Packages / files to port
- `internal/discovery` → project scan of `~/.claude/projects/{encoded-path}/`, path decode (encoded → real path).
- `internal/cache` → LRU session cache (Go uses `golang-lru/v2`; pick a Rust equivalent) + byte-offset incremental detail (skip unchanged leading bytes on re-parse).

## Parity check
Same project/session enumeration; incremental re-parse skips same bytes.

## Invariants in force
- Always: #1, #2, #5, #6.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W03 (config / path encoding), W04 (parsing feeds cached detail).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
