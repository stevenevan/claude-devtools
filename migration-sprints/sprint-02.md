# Sprint 2 (Week 15: Apr 6 - Apr 12)

**Phase**: 1 - Quality Foundation
**Theme**: Rust Analysis & Discovery Tests

## Deliverables

- [ ] Unit tests for `analysis/chunk_builder.rs` — state machine transitions, AI buffer flushing [BE] [L]
- [ ] Unit tests for `analysis/chunk_factory.rs` — all chunk type builders with metric correctness [BE] [M]
- [ ] Unit tests for `discovery/path_decoder.rs` — encode/decode roundtrip, lossy paths with dashes [BE] [M]
- [ ] Unit tests for `discovery/session_lister.rs` — pagination, sorting, filtering [BE] [M]

## Key Files

- `src-tauri/src/analysis/chunk_builder.rs`
- `src-tauri/src/analysis/chunk_factory.rs`
- `src-tauri/src/discovery/path_decoder.rs`
- `src-tauri/src/discovery/session_lister.rs`

## Done When

`cargo test` passes with 80+ total tests; chunk builder tests verify correct sequences for 5+ message patterns.
