# Sprint 5 (Week 18: Apr 27 - May 3)

**Phase**: 2 - Live Session Experience
**Theme**: Incremental Parsing Backend
**Depends on**: Sprints 1-2 (Rust parsing tests)

## Deliverables

- [x] Byte-offset tracking in `SessionCache` — already implemented with `IncrementalState` [BE] [L]
- [x] `get_session_detail_incremental` command — already implemented in commands.rs [BE] [L]
- [x] Rust tests for incremental cache state — set/get/update/remove, invalidation clears state [BE] [M]
- [x] File watcher emits `FileChangeEvent` with project_id/session_id — already implemented [BE] [M]

## Key Files

- `src-tauri/src/cache.rs`
- `src-tauri/src/parsing/session_parser.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/watcher.rs`

## Done When

Incremental parse of 10,000-line session < 50ms; Rust tests cover happy path + 3 edge cases.
