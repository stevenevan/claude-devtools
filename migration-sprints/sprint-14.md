# Sprint 14 (Week 27: Jun 29 – Jul 5)

**Phase**: 4 – Advanced Features & Polish
**Theme**: Dashboard State Persistence

## Deliverables

- [x] Zustand `persist` middleware with `localStorage` backend in `store/index.ts` [FE] [M]
- [x] Persist pane layout — open tabs, active tab per pane, split views, width fractions [FE] [M]
- [x] Persist UI preferences — sidebar collapsed, active activity, view mode, sidebar width [FE] [S]
- [x] `partialize` to strip transient fields (loading flags, errors, scroll positions, Maps, Sets) [FE] [M]
- [x] `onRehydrateStorage` callback to sync root-level state and fetch active session detail on startup [FE] [M]

## Key Files

- `src/renderer/store/index.ts`
- `src/renderer/store/types.ts`

## Done When

App restart restores open tabs, pane layout, sidebar state, and active activity; session data re-fetches on rehydration.
