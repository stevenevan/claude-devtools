# Sprint 13 (Week 26: Jun 22 - Jun 28)

**Phase**: 4 - Feature Completeness
**Theme**: Session Comparison — Backend + Layout
**Depends on**: Sprint 3 (component test infra)

## Deliverables

- [x] `SessionComparison` component — already implemented with side-by-side metrics and tool usage [FE] [L]
- [x] Comparison tab type with compareSessionId/compareProjectId — already in tabs.ts [FE] [M]
- [x] PaneContent routes comparison tab type to SessionComparison component [FE] [M]

## Key Files

- `src-tauri/src/commands.rs` (new command)
- `src/renderer/types/tabs.ts` (existing compareSessionId/compareProjectId fields)
- `src/renderer/components/` (new: ComparisonView.tsx)
- `src/renderer/components/sidebar/SessionItem.tsx` (context menu)

## Done When

Right-click -> "Compare with..." -> pick session -> split-pane view renders; synchronized scrolling works.
