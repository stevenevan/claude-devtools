# Sprint 14 (Week 27: Jun 29 - Jul 5)

**Phase**: 4 - Feature Completeness
**Theme**: Session Comparison — Diff & Metrics

## Deliverables

- [x] Comparison metrics panel — already shows tokens/cost/duration/messages/model side-by-side [FE] [M]
- [x] Tool usage comparison — all tool names with counts per session [FE] [M]
- [ ] Diff visualization (divergence highlighting) — deferred (requires chunk alignment algorithm) [FE] [L]
- [ ] Comparison navigation (next/prev divergence) — deferred [FE] [M]

## Key Files

- `src/renderer/components/` (ComparisonView.tsx and sub-components)
- `src/renderer/hooks/useKeyboardShortcuts.ts` (new shortcuts)

## Done When

Divergence points highlighted; metrics show correct deltas; "Next difference" works; 10+ tests.
