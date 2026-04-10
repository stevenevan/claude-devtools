# Sprint 17 (Week 30: Jul 20 – Jul 26)

**Phase**: 4 – Advanced Features & Polish
**Theme**: Comparison Diff Visualization

## Deliverables

- [x] `ConversationDiff` component within `SessionComparison` — side-by-side turn comparison [FE] [L]
- [x] `extractTurns()` — walk chunks to pair user messages with following AI response summaries [FE] [M]
- [x] `isDivergent()` — normalized whitespace comparison for detecting conversation divergences [FE] [S]
- [x] Divergence navigation (prev/next buttons) with `scrollIntoView` and index tracking [FE] [M]
- [x] Visual highlighting — amber border/background on divergent turns, dash placeholders for missing turns [FE] [S]

## Key Files

- `src/renderer/components/chat/SessionComparison.tsx`

## Done When

Session comparison shows turn-by-turn diff with amber divergence highlights and prev/next navigation.
