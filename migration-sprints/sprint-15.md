# Sprint 15 (Week 28: Jul 6 - Jul 12)

**Phase**: 4 - Feature Completeness
**Theme**: Bookmarks, Tags & Subagent Navigation

## Deliverables

- [x] "Compare with Current Session" context menu action in sidebar [FE] [M]
- [x] Backend bookmark/tag commands already wired in tauriClient.ts [FE] [M]
- [ ] Bookmark/tag UI — header button, tag editor, sidebar filter — deferred [FE] [L]
- [ ] Enhanced subagent navigation — deferred [FE] [L]

## Key Files

- `src/renderer/store/slices/subagentSlice.ts`
- `src/renderer/components/sidebar/SidebarQuickFilters.tsx`
- `src/renderer/api/tauriClient.ts` (bookmark/tag API calls)
- `src-tauri/src/config/commands.rs` (existing: config_add_bookmark, config_set_session_tags)

## Done When

Bookmark/tag sessions; filter by them in sidebar; subagent breadcrumbs navigate nested hierarchies; connected to Rust backend.
