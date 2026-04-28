# Sprint 31 — Week of 2026-08-03 | Playback

## Subagent Spawn Tree Explorer

### Deliverables
1. **Nested tree** — extend `SubagentTreeView.tsx` to handle N-level nesting (current caps at 2). Collapse/expand per node.
2. Breadcrumb trail above chat when inside a subagent (`SubagentBreadcrumb.tsx`).
3. Filter: hide subagents with 0 tool calls; toggle in header.

### Files
- `src/renderer/components/chat/SubagentTreeView.tsx`
- `src/renderer/components/chat/SubagentBreadcrumb.tsx`
- `src/renderer/components/chat/SubagentDetailPanel.tsx`
- `src/renderer/utils/subagentTreeLayout.ts` (new)

### Dependencies
- Existing `SubagentDetailPanel`

### Verification
- Unit test: layout handles 5-level depth without overflow
- Manual: collapse state persists across tab switches
