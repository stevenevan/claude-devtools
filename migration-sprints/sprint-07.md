# Sprint 7 (Week 20: May 11 - May 17)

**Phase**: 2 - Live Session Experience
**Theme**: Live Metrics & Streaming Polish

## Deliverables

- [ ] `LiveMetricsBar` — real-time token counter, cost, tool count, elapsed time during streaming [FE] [M]
- [ ] Streaming-aware context tracking — incremental `ContextStats` update, live `ContextBadge` [FE] [M]
- [ ] Streaming edge cases — completion detection, compaction mid-stream, subagent spawning [FE] [L]
- [ ] Streaming toggle in session header — pause/resume, visual indicator, keyboard shortcut [FE] [S]

## Key Files

- `src/renderer/components/common/TokenUsageDisplay.tsx`
- `src/renderer/utils/contextTracker.ts`
- `src/renderer/components/chat/ContextBadge.tsx` (or related)
- `src/renderer/store/slices/sessionDetailSlice.ts`

## Done When

Tokens update in real-time; completion detected within 2s; compaction mid-stream doesn't corrupt UI.
