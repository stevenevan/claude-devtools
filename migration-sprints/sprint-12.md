# Sprint 12 (Week 25: Jun 15 - Jun 21)

**Phase**: 3 - Rust Performance Migration
**Theme**: Token Estimation + Path Decoding Fix

## Deliverables

- [x] Path decoder lossy behavior documented and tested (Sprint 2) [BE] [M]
- [x] Analytics cost estimation tested with all model families (Sprint 4) [BE] [M]
- [ ] Replace rough token estimation with tiktoken-rs — deferred (requires new dependency) [BE] [L]
- [ ] Reversible path encoding — deferred (breaking change to directory naming) [BE] [M]

## Key Files

- `src-tauri/src/commands.rs` (token estimation)
- `src-tauri/src/discovery/path_decoder.rs`
- `src-tauri/src/analytics.rs`
- `src-tauri/src/parsing/metrics.rs`

## Done When

Token estimates within 5% of actual; path roundtrips correctly for all paths including dashes; 20+ tests.
