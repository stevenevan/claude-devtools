# Sprint 32 — Week of 2026-08-10 | Customization

## Dashboard Widget Drag-Drop Customization

### Deliverables
1. **Widget registry** — each dashboard panel registered with `{ id, title, defaultSize }`.
2. Drag-drop reorder via HTML5 DnD (no new dep); persisted layout in `configSlice`.
3. Hide/show per widget via gear menu.
4. "Reset layout" button restores defaults.

### Files
- `src/renderer/components/dashboard/DashboardView.tsx`
- `src/renderer/components/dashboard/widgetRegistry.ts` (new)
- `src/renderer/store/slices/configSlice.ts` (add `dashboardLayout`)
- `src-tauri/src/config/types.rs` (persist across restarts)
- `src-tauri/src/config/commands.rs`

### Dependencies
- All dashboard widgets (sprints 1, 9, 10, 13, 18, 21, 22, 23, 24, 25)

### Verification
- Unit test: layout reducer adds/removes/reorders correctly
- Manual: drag from position 3→1 persists across app restart
