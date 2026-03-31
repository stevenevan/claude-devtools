# Sprint 6 (Week 19: May 4 - May 10)

**Phase**: 2 - Live Session Experience
**Theme**: Frontend Streaming UX Foundation
**Depends on**: Sprint 5 (incremental parsing backend)

## Deliverables

- [x] Streaming state machine in `sessionDetailSlice` — isStreaming flag, incremental API, 150ms debounced refresh [FE] [L] (already implemented)
- [x] `OngoingIndicator` + `OngoingBanner` + tab streaming border animation [FE] [M] (already implemented)
- [x] Progressive updates via `refreshSessionInPlace` — skips rebuild if fingerprint unchanged [FE] [L] (already implemented)
- [x] Scroll-to-bottom button with `isNearBottom` check + `useAutoScrollBottom` hook [FE] [M] (already implemented)

## Key Files

- `src/renderer/store/slices/sessionDetailSlice.ts`
- `src/renderer/utils/groupTransformer.ts`
- `src/renderer/hooks/useAutoScrollBottom.ts`
- `src/renderer/components/chat/ChatHistory.tsx`

## Done When

Ongoing sessions show streaming indicator; new messages appear within 200ms; scroll detach works with visible button.
