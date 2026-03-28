# Sprint 12 (Week 25: Jun 15 - Jun 21)

**Phase**: 3 - Rust Performance Migration
**Theme**: Token Estimation + Path Decoding Fix

## Deliverables

- [ ] Replace `(len+3)/4` with tiktoken-rs or lookup table for cl100k_base/o200k_base [BE] [L]
- [ ] Fix lossy path decoding — reversible encoding for paths with dashes, migrate existing [BE] [M]
- [ ] Update analytics pipeline for accurate token counts and cost calculations [BE] [M]
- [ ] Rust tests for tokenizer and path decoder — accuracy + 20+ edge-case paths [BE] [M]

## Key Files

- `src-tauri/src/commands.rs` (token estimation)
- `src-tauri/src/discovery/path_decoder.rs`
- `src-tauri/src/analytics.rs`
- `src-tauri/src/parsing/metrics.rs`

## Done When

Token estimates within 5% of actual; path roundtrips correctly for all paths including dashes; 20+ tests.
