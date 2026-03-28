# Sprint 6 (Week 19: May 4 - May 10)

**Phase**: 2 - Live Session Experience
**Theme**: Frontend Streaming UX Foundation
**Depends on**: Sprint 5 (incremental parsing backend)

## Deliverables

- [ ] Streaming state machine in `sessionDetailSlice` — isStreaming transitions, incremental API, batched updates [FE] [L]
- [ ] `StreamingIndicator` component — animated banner with elapsed time, model, live token count [FE] [M]
- [ ] Progressive message appending in `groupTransformer` — append instead of rebuild, preserve expansion states [FE] [L]
- [ ] Streaming-aware auto-scroll — stay pinned while streaming, "Jump to latest" when detached [FE] [M]

## Key Files

- `src/renderer/store/slices/sessionDetailSlice.ts`
- `src/renderer/utils/groupTransformer.ts`
- `src/renderer/hooks/useAutoScrollBottom.ts`
- `src/renderer/components/chat/ChatHistory.tsx`

## Done When

Ongoing sessions show streaming indicator; new messages appear within 200ms; scroll detach works with visible button.
