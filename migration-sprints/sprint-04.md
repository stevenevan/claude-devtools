# Sprint 4 (Week 17: Apr 20 - Apr 26)

**Phase**: 1 - Quality Foundation
**Theme**: Hook Tests + Remaining Rust Coverage

## Deliverables

- [x] Tests for `isNearBottom` — threshold edges, zero/large threshold, non-scrollable container [FE] [M]
- [x] Tests for `findAIGroupByTimestamp` and `findChatItemByTimestamp` — exact match, closest fallback, mixed types [FE] [M]
- [x] Rust tests for `analytics.rs` — model pricing, cost estimation, display names, time buckets, granularity [BE] [M]
- [ ] Rust tests for `notifications/manager.rs` — deferred (heavy state/filesystem deps) [BE] [M]
- [ ] Rust tests for `config/manager.rs` — deferred (heavy state/filesystem deps) [BE] [M]

## Key Files

- `src/renderer/hooks/useAutoScrollBottom.ts`
- `src/renderer/hooks/useKeyboardShortcuts.ts`
- `src-tauri/src/notifications/manager.rs`
- `src-tauri/src/analytics.rs`
- `src-tauri/src/config/manager.rs`

## Done When

40+ hook test assertions; `cargo test` at 120+ total tests covering parsing, analysis, discovery, notifications, analytics, config.
