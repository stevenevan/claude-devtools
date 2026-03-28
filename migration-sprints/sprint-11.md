# Sprint 11 (Week 24: Jun 8 - Jun 14)

**Phase**: 3 - Rust Performance Migration
**Theme**: Rust-Powered Search

## Deliverables

- [ ] `search.rs` — full-text search with regex, match positions + context, per-session and cross-project [BE] [L]
- [ ] IPC commands `search_session_content` / `search_project_content` [BE] [M]
- [ ] Wire `conversationSlice` search to Rust backend, async with debounce, loading indicator [FE] [M]
- [ ] Search result pagination — remove 500-match cap, cursor-based, "Load more" button [FE] [M]

## Key Files

- `src/renderer/store/slices/conversationSlice.ts` (MAX_SEARCH_MATCHES)
- `src-tauri/src/` (new: search.rs)
- `src-tauri/src/commands.rs`
- `src/renderer/components/search/SearchBar.tsx`

## Done When

50,000-line session search < 100ms; pagination beyond 500 results; regex supported; loading state shown.
