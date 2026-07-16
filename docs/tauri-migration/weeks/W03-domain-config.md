# W03 — Domain + config foundation   ·   Cycle B: Core read pipeline

## Goal
Port the DTO layer and config/root-resolution so the Rust backend resolves the same `~/.claude` effective root and round-trips the shared types.

## Scope
Domain + config foundation. `internal/domain` DTOs → serde structs matching `@shared/types`; `internal/config` root resolution, `~/.claude` paths, path encoding; `internal/ptr`.

## Packages / files to port
- `internal/domain` → serde structs matching `frontend/src/shared/types` (`@shared/types`). Field names / JSON tags must match byte-for-byte for parity.
- `internal/config` → root resolution, `~/.claude` path building, path encoding (`/Users/name/project` → `-Users-name-project`).
- `internal/ptr` (`internal/ptr/ptr.go`) → Rust equivalent (optional/nil-pointer helpers).

## Parity check
Rust config resolves same effective root; serde round-trips a fixture DTO.

## Invariants in force
- Always: #1, #2, #5, #6.
(full text: see migration-prompt.md "Invariants")

## Premise gate
None — inherits W01's resolved Tauri version.

## Depends on
W02 (seam in place).

## Per-week loop
`/plan-with-review` scoped to this week → implement (Rust backend) → keep the Go backend runnable → run parity check + gates (`cargo build`/`cargo test`, `bunx tsc --noEmit`, `bun test`) → commit with explicit paths. Full loop: migration-prompt.md "Per-week loop".
