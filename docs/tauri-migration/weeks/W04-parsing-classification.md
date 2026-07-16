# W04 — Parsing + classification   ·   Cycle B: Core read pipeline

## Goal
Port streaming JSONL parsing + message classification so Rust emits identical `ParsedMessage[]` to Go on the fixture corpus.

## Scope
Parsing + classification. `internal/parsing` streaming JSONL → `ParsedMessage` (large-buffer `bufio` equivalent) + classifier (`HardNoise|User|Ai|System|Event|Compact`).

## Packages / files to port
- `internal/parsing` → line-by-line streaming JSONL reader (Rust `BufReader` with a large line buffer, mirroring the Go `bufio.Scanner` large-buffer setup) producing `ParsedMessage`.
- Classifier (`internal/parsing/classifier.go`) → `MessageCategory` = `HardNoise | User | Ai | System | Event | Compact`. Same category for the same input line.

## Parity check
Rust parser + Go parser emit identical `ParsedMessage[]` on the fixture corpus.

## Invariants in force
- Always: #1, #2, #5, #6.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W03 (domain DTOs + config).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
