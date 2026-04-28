# Sprint 20 — Week of 2026-05-18 | Visualization

## Tool Execution Flame Graph

### Deliverables
1. **Flame graph component** — stacked horizontal bars of tool executions ordered by start time; width = duration, colour = tool category. Nested bars for subagent spawns (Task → child tools).
2. Zoom (wheel) + pan (drag) on canvas; min-zoom = full session.
3. Tooltip: tool name, duration, token delta, success/error state.
4. Keyboard: `f` focus selected tool in flame graph; arrows move between peers.

### Files
- `src/renderer/components/chat/ToolFlameGraph.tsx` (new)
- `src/renderer/components/chat/SessionSummaryBar.tsx` (add toggle button)
- `src/renderer/utils/flameGraphLayout.ts` (new — layout math)
- `src/renderer/hooks/useKeyboardShortcuts.ts` (wire `f`)

### Dependencies
- Existing `tool_linking` pipeline in Rust (already surfaces durations)
- Existing subagent `Process` data

### Verification
- Unit test: layout handles nested subagent bars and gaps
- Manual: session with 50+ tool calls renders <200ms, zoom smooth
