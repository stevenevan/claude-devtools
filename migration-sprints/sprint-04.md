# Sprint 4 (Week 17: Apr 20 - Apr 26)

**Phase**: 1 - Quality Foundation
**Theme**: Hook Tests + Remaining Rust Coverage

## Deliverables

- [ ] Tests for `useAutoScrollBottom` — scroll-to-bottom, unlock on manual scroll, re-lock [FE] [M]
- [ ] Tests for `useKeyboardShortcuts` — registration, modifier combos, scope isolation [FE] [M]
- [ ] Rust tests for `notifications/manager.rs` — CRUD, throttle dedup, persistence [BE] [M]
- [ ] Rust tests for `analytics.rs` — time buckets, project usage, model extraction [BE] [M]
- [ ] Rust tests for `config/manager.rs` — get/update, trigger CRUD, pin/unpin, bookmarks [BE] [M]

## Key Files

- `src/renderer/hooks/useAutoScrollBottom.ts`
- `src/renderer/hooks/useKeyboardShortcuts.ts`
- `src-tauri/src/notifications/manager.rs`
- `src-tauri/src/analytics.rs`
- `src-tauri/src/config/manager.rs`

## Done When

40+ hook test assertions; `cargo test` at 120+ total tests covering parsing, analysis, discovery, notifications, analytics, config.
