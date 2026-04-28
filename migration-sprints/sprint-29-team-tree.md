# Sprint 29 — Week of 2026-07-20 | Playback

## Agent Team Visualization Tree

### Deliverables
1. **Team tree view** — render `Process.team` hierarchies as a tree: team root → members → spawned subagents. Uses existing team enrichment from `SubagentResolver`.
2. Node badges: member colour dot, status (active / completed / ended), tool count.
3. Click node → scroll chat to first tool call by that member.
4. New tab type in `paneSlice`: `team-tree`.

### Files
- `src/renderer/components/chat/TeamTreeView.tsx` (new)
- `src/renderer/components/chat/SubagentDetailPanel.tsx` (link into tree)
- `src/renderer/store/slices/paneSlice.ts` (new tab kind)
- `src/renderer/utils/teamTreeBuilder.ts` (new)

### Dependencies
- Existing team metadata (Process.team)
- Existing `SubagentDetailPanel`

### Verification
- Unit test: nested team with 3 members builds correct tree
- Manual: click-to-scroll accurate; tree stable under session reload
