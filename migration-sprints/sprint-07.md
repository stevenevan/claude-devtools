# Sprint 7 (Week 20: May 11 - May 17)

**Phase**: 2 - Live Session Experience
**Theme**: Live Metrics & Streaming Polish

## Deliverables

- [x] `LiveMetricsBar` — new component with real-time tokens, cost, msg count, elapsed time [FE] [M]
- [x] Streaming-aware context tracking — already implemented via ContextBadge + ContextStats [FE] [M]
- [x] Streaming edge cases — completion via isOngoing, compaction via phaseInfo, staleness timeout [FE] [L]
- [ ] Streaming toggle in session header — deferred (low priority given auto-detection) [FE] [S]

## Key Files

- `src/renderer/components/common/TokenUsageDisplay.tsx`
- `src/renderer/utils/contextTracker.ts`
- `src/renderer/components/chat/ContextBadge.tsx` (or related)
- `src/renderer/store/slices/sessionDetailSlice.ts`

## Done When

Tokens update in real-time; completion detected within 2s; compaction mid-stream doesn't corrupt UI.
