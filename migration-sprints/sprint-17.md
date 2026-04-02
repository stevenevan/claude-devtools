# Sprint 17 (Week 30: Jul 20 - Jul 26)

**Phase**: 5 - Polish & Accessibility
**Theme**: Error Handling & User Feedback

## Deliverables

- [x] Error boundaries — added section-level boundaries in PaneContent for global + per-tab content [FE] [M]
- [x] ErrorBoundary component with "Try Again" and "Reload App" actions — already existed [FE] [M]
- [x] Sonner toast system available via `sonner.tsx` component [FE] [M]
- [ ] SSH retry/error recovery — deferred (requires connection testing) [BE+FE] [L]

## Key Files

- `src/renderer/components/common/ErrorBoundary.tsx`
- `src-tauri/src/ssh/connection_manager.rs`
- `src-tauri/src/ssh/commands.rs`
- `src/renderer/store/slices/connectionSlice.ts`

## Done When

No error goes only to console; error boundaries catch failures in all 4 sections; SSH reconnects after transient failures.
