# Sprint 27 — Week of 2026-07-06 | Playback

## Session Replay Mode

### Deliverables
1. **Replay state** — new `replaySlice.ts`: `{ mode: 'off'|'stepping', currentChunkIndex, speed }`.
2. `ReplayControls.tsx` — play/pause/step-forward/step-back/speed (1x/2x/4x), mounted above `ChatHistory` when active.
3. `ChatHistory.tsx` respects replay cursor: fade chunks beyond cursor.
4. Keyboard: space = play/pause, `,`/`.` = step back/forward.

### Files
- `src/renderer/store/slices/replaySlice.ts` (new)
- `src/renderer/components/chat/ReplayControls.tsx` (new)
- `src/renderer/components/chat/ChatHistory.tsx` (respect cursor)
- `src/renderer/hooks/useKeyboardShortcuts.ts`
- `src/renderer/store/index.ts` (wire slice)

### Dependencies
- Sprint 26 (scrubber integration)

### Verification
- Unit test: step-forward past end clamps; pause stops timer
- Manual: 60fps during 4x playback on 500-chunk session
