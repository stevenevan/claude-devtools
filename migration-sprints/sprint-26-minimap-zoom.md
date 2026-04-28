# Sprint 26 — Week of 2026-06-29 | Playback

## Timeline Scrubbing + Zoom Controls for Minimap

### Deliverables
1. **sessionDetailSlice.ts split (prerequisite)** — file is ~726 lines and approaches 800 cap; sprint 27 replay work will push past. Split into `sessionDetailSlice.ts` (state + entry actions) + `sessionDetailActions.ts` (complex reducers). No behavioural change (architect directive #4).
2. **Scroll authority protocol** — define `ScrollController` module. Writer identity is an open **string union** (not a fixed enum) so sprint 27 (`replay-cursor`) and the virtualizer (`virtualizer` writer) can extend without touching this sprint. All scroll writes in `ChatHistory.tsx` + `useTabNavigationController.ts` + `@tanstack/react-virtual` resize path go through it (architect directive #1).
3. **Zoom control** — in `SessionMinimap.tsx`: wheel-to-zoom (1x–8x), pan on drag. Zoomed minimap shows more tick detail (tool icons at ≥4x).
4. **Scrubber handle** — draggable playhead on minimap synced with chat scroll position via `ScrollController` (two-way, non-oscillating).
5. Keyboard: `[` / `]` jump to prev/next chunk boundary on scrubber.

### Files
- `src/renderer/components/chat/SessionMinimap.tsx`
- `src/renderer/hooks/useTabNavigationController.ts` (scroll sync)
- `src/renderer/hooks/useKeyboardShortcuts.ts`
- `src/renderer/utils/minimapLayout.ts` (new — zoom math)
- `src/renderer/utils/scrollController.ts` (new — authority arbiter, open-union writer)
- `src/renderer/store/slices/sessionDetailSlice.ts` (trim)
- `src/renderer/store/slices/sessionDetailActions.ts` (new — extracted reducers)

### Dependencies
- Sprint 17 (minimap base)

### Verification
- Unit test: zoom math maps scroll→minimap coord correctly
- Manual: two-way scroll sync does not oscillate
