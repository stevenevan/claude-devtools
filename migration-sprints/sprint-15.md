# Sprint 15 (Week 28: Jul 6 - Jul 12)

**Phase**: 4 - Feature Completeness
**Theme**: Bookmarks, Tags & Subagent Navigation

## Deliverables

- [ ] Bookmark/tag UI — bookmark button in header, tag editor with autocomplete, sidebar filter, color coding [FE] [L]
- [ ] Session filtering by bookmarks/tags — extend sidebar filters, persist state, active filter indicator [FE] [M]
- [ ] Enhanced subagent navigation — full breadcrumb trail in `subagentSlice`, expand-in-place option, search integration [FE] [L]
- [ ] Wire frontend to existing Rust commands (`config_add_bookmark`, `config_set_session_tags`, etc.) [FE] [M]

## Key Files

- `src/renderer/store/slices/subagentSlice.ts`
- `src/renderer/components/sidebar/SidebarQuickFilters.tsx`
- `src/renderer/api/tauriClient.ts` (bookmark/tag API calls)
- `src-tauri/src/config/commands.rs` (existing: config_add_bookmark, config_set_session_tags)

## Done When

Bookmark/tag sessions; filter by them in sidebar; subagent breadcrumbs navigate nested hierarchies; connected to Rust backend.
