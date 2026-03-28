# Sprint 5 (Week 18: Apr 27 - May 3)

**Phase**: 2 - Live Session Experience
**Theme**: Incremental Parsing Backend
**Depends on**: Sprints 1-2 (Rust parsing tests)

## Deliverables

- [ ] Byte-offset tracking in `SessionCache` — store last-parsed offset, `parse_jsonl_file_incremental(path, offset)` [BE] [L]
- [ ] Enhance `get_session_detail_incremental` — accept last-known message count, return only new chunks [BE] [L]
- [ ] Rust tests for incremental parsing — byte offset across appends, truncation, concurrent access [BE] [M]
- [ ] Wire file watcher to emit incremental change hints (byte offset/message count in `FileChangeEvent`) [BE] [M]

## Key Files

- `src-tauri/src/cache.rs`
- `src-tauri/src/parsing/session_parser.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/watcher.rs`

## Done When

Incremental parse of 10,000-line session < 50ms; Rust tests cover happy path + 3 edge cases.
