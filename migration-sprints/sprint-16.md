# Sprint 16 (Week 29: Jul 13 - Jul 19)

**Phase**: 4 - Feature Completeness
**Theme**: Dashboard Persistence + Todo + Quick Filters

## Deliverables

- [ ] Dashboard state persistence — save time range, chart type, filters to IndexedDB, restore on open [FE] [M]
- [ ] Todo panel refinement — sync with `~/.claude/todos/{sessionId}.json`, real-time watcher updates, completion status [FE] [M]
- [ ] Expand quick filters — model, duration range, token range, has errors, has subagents, date range [FE] [L]
- [ ] Component tests for dashboard, todo panel, quick filters [FE] [M]

## Key Files

- `src/renderer/components/dashboard/DashboardView.tsx`
- `src/renderer/components/dashboard/AnalyticsDashboard.tsx`
- `src/renderer/utils/contextStorage.ts` (IndexedDB pattern to reuse)
- `src/renderer/components/sidebar/SidebarQuickFilters.tsx`

## Done When

Dashboard remembers state across restarts; todos update within 2s; 6 new filter criteria; 15+ tests.
