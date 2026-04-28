# Sprint 49 — Week of 2026-12-07 | Hardening

## Onboarding Tour + Empty-State Polish

### Deliverables
1. **First-run tour** — 5-step tooltip sequence: project scan, sessions list, minimap, dashboard, settings. Skippable; dismissable; replayable from Help menu.
2. **Empty states** — unified empty-state component used across: no-sessions, no-search-results, no-annotations, no-bookmarks, no-dashboard-data.
3. First-run flag in config; reset via settings.

### Files
- `src/renderer/components/common/EmptyState.tsx` (new)
- `src/renderer/components/onboarding/OnboardingTour.tsx` (new)
- `src/renderer/components/chat/ChatHistoryEmptyState.tsx` (refactor to use EmptyState)
- `src/renderer/components/sidebar/ProjectList.tsx`
- `src/renderer/components/search/` (empty state)
- `src/renderer/store/slices/configSlice.ts` (first-run flag)
- `src-tauri/src/config/types.rs`

### Dependencies
- Sprint 12 (help panel surface to replay tour)

### Verification
- Unit test: tour step reducer advances / skips / completes correctly
- Manual: fresh config triggers tour; skip persists
