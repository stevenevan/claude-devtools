# Sprint 13 (Week 26: Jun 22 - Jun 28)

**Phase**: 4 - Feature Completeness
**Theme**: Session Comparison — Backend + Layout
**Depends on**: Sprint 3 (component test infra)

## Deliverables

- [ ] Rust command `get_session_comparison` — parallel chunk arrays, alignment hints, diff metrics [BE] [L]
- [ ] `ComparisonView` component skeleton — split-pane, synchronized scrolling, session metadata headers [FE] [L]
- [ ] Comparison tab opening flow — "Compare with..." context menu, session picker, populate tab fields [FE] [M]

## Key Files

- `src-tauri/src/commands.rs` (new command)
- `src/renderer/types/tabs.ts` (existing compareSessionId/compareProjectId fields)
- `src/renderer/components/` (new: ComparisonView.tsx)
- `src/renderer/components/sidebar/SessionItem.tsx` (context menu)

## Done When

Right-click -> "Compare with..." -> pick session -> split-pane view renders; synchronized scrolling works.
