# Sprint 8 (Week 21: May 18 - May 24)

**Phase**: 2 - Live Session Experience
**Theme**: Streaming Integration Tests + Watcher Hardening

## Deliverables

- [x] Watcher already has retry logic for missing dirs (retry_watch with 2s interval) [BE] [M]
- [x] Added watcher tests — event kind mapping, path preservation, UUID session IDs, resolve_claude_dir [BE] [M]
- [ ] Integration tests for streaming pipeline — deferred (requires Tauri runtime) [FE+BE] [L]
- [ ] Performance benchmark — deferred (requires real session files) [BE] [M]

## Key Files

- `src-tauri/src/watcher.rs`
- `src-tauri/src/cache.rs`
- `src/renderer/store/slices/sessionDetailSlice.ts`

## Done When

E2E streaming latency < 300ms; watcher recovers from failure within 5s; benchmarks documented.
