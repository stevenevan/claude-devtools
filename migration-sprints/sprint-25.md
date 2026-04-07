# Sprint 25 (Week 38: Sep 14 - Sep 20)

**Phase**: Feature Completeness
**Theme**: Comparison Diff Visualization

## Deliverables

- [x] ConversationDiff component — side-by-side turn comparison with divergence highlighting [FE] [L]
- [x] Turn extraction from SessionDetail chunks (user messages + AI response summaries) [FE] [M]
- [x] Divergence detection — identifies turns where user messages differ [FE] [S]
- [x] Divergence navigation — prev/next buttons scroll to highlighted differences [FE] [M]
- [x] Visual highlighting — amber border/background on divergent turns [FE] [S]

## Key Files

- `src/renderer/components/chat/SessionComparison.tsx` — ConversationDiff, extractTurns(), isDivergent()

## Architecture

- `extractTurns()` walks chunks to pair user messages with following AI responses
- Each turn shows: user text (truncated 200 chars), tool count, AI summary (truncated 80 chars)
- Divergence is detected by comparing normalized whitespace of user messages
- Missing turns (when sessions have different lengths) shown as "—" placeholders
- `turnRefs` Map + `scrollIntoView` for divergence navigation

## Done When

Session comparison shows side-by-side conversation turns with amber highlights on divergences; prev/next buttons navigate between differences; 473 tests pass.
