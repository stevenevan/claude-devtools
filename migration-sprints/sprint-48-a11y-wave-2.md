# Sprint 48 — Week of 2026-11-30 | Hardening

## Accessibility Audit (Wave 2)

### Deliverables
1. **Audit sweep** — run `axe-core` via Playwright on 10 key views; log findings.
2. **Fixes** — focus-visible outlines, ARIA roles on custom widgets (Minimap, FlameGraph, TreeView), live-region announcements for replay + notifications, keyboard traps in modals.
3. Add `aria-label` conventions doc to `docs/accessibility.md`.

### Files
- `test/a11y/axe.spec.ts` (new — Playwright)
- `src/renderer/components/chat/SessionMinimap.tsx`
- `src/renderer/components/chat/ToolFlameGraph.tsx`
- `src/renderer/components/chat/SubagentTreeView.tsx`
- `src/renderer/components/chat/ReplayControls.tsx`
- `docs/accessibility.md` (new)

### Dependencies
- Sprint 20 (flame graph), 27 (replay), 31 (tree explorer)
- Add dev deps: `@axe-core/playwright`, `playwright`

### Verification
- `bun run test:a11y` 0 serious/critical violations
- Manual: screen-reader announces replay play/pause; keyboard cycles through all dashboard cards
