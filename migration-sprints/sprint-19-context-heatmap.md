# Sprint 19 — Week of 2026-05-11 | Visualization

## Context Window Heatmap Timeline

### Deliverables
1. **Heatmap bar** — horizontal strip below `SessionMinimap` rendering per-turn context fill as a gradient (cool→hot as fill % rises). Colour segments keyed by dominant `ContextInjection.category`.
2. Hover tooltip: turn index, total tokens, top 3 categories with percentages.
3. Click-to-scroll: hovering + clicking segment scrolls chat to that turn.
4. Toggle in view header to show/hide heatmap (persisted via `uiSlice`).
5. **Pure presentational split** — core component stays presentational in `chat/ContextHeatmap.tsx`. A thin wrapper `dashboard/ContextHeatmapTile.tsx` handles `DashboardWidget` registration. No self-registration from the chat-embedded path (architect directive #12).

### Files
- `src/renderer/components/chat/ContextHeatmap.tsx` (new — presentational)
- `src/renderer/components/dashboard/ContextHeatmapTile.tsx` (new — registers widget)
- `src/renderer/components/chat/ChatHistory.tsx` (mount)
- `src/renderer/components/chat/SessionContextPanel/` (reuse category styling)
- `src/renderer/utils/contextTracker.ts` (expose per-turn category breakdown)
- `src/renderer/store/slices/uiSlice.ts`

### Dependencies
- Existing `computeContextStats` + `processSessionContextWithPhases`
- Sprint 17 (minimap position reference)

### Verification
- Unit test: per-turn category breakdown reducer
- Manual: scroll on click, hover tooltip content, toggle persistence
