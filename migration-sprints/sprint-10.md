# Sprint 10 (Week 23: Jun 1 - Jun 7)

**Phase**: 3 - Rust Performance Migration
**Theme**: Context Tracking -> Rust

## Deliverables

- [ ] `context_tracker.rs` — port `computeContextStats` + `processSessionContextWithPhases`, all 6 categories [BE] [L]
- [ ] IPC command `get_context_stats` — returns ContextStats map + ContextPhaseInfo [BE] [M]
- [ ] `sessionDetailSlice` uses Rust context stats on load and incremental refresh [FE] [M]
- [ ] Rust tests for context tracking — all 6 categories, phase boundaries, compaction [BE] [M]

## Key Files

- `src/renderer/utils/contextTracker.ts` (source to port)
- `src/renderer/types/contextInjection.ts` (type reference)
- `src-tauri/src/` (new: context_tracker.rs)
- `src/renderer/store/slices/sessionDetailSlice.ts`

## Done When

1000-message context computation < 20ms Rust; ContextBadge/SessionContextPanel identical; 15+ Rust tests.
