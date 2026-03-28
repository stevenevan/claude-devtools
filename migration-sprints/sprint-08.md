# Sprint 8 (Week 21: May 18 - May 24)

**Phase**: 2 - Live Session Experience
**Theme**: Streaming Integration Tests + Watcher Hardening

## Deliverables

- [ ] Integration tests for full streaming pipeline — simulate JSONL append -> parse -> render -> metrics [FE+BE] [L]
- [ ] Rust tests for `watcher.rs` — debounce, path extraction, concurrent start/stop [BE] [M]
- [ ] Watcher error recovery — auto-restart, exponential backoff, diagnostic events [BE] [M]
- [ ] Performance benchmark: end-to-end latency from file write to UI update [BE] [M]

## Key Files

- `src-tauri/src/watcher.rs`
- `src-tauri/src/cache.rs`
- `src/renderer/store/slices/sessionDetailSlice.ts`

## Done When

E2E streaming latency < 300ms; watcher recovers from failure within 5s; benchmarks documented.
