# Sprint 14 (Week 27: Jun 29 - Jul 5)

**Phase**: 4 - Feature Completeness
**Theme**: Session Comparison — Diff & Metrics

## Deliverables

- [ ] Diff visualization — highlight divergence points, color-code added/removed/changed chunks [FE] [L]
- [ ] Comparison metrics panel — side-by-side tokens/cost/duration/tools, percentage deltas, bar charts [FE] [M]
- [ ] Comparison navigation — jump to next/prev divergence, filter to differences only, keyboard shortcuts [FE] [M]
- [ ] Component tests for `ComparisonView` [FE] [M]

## Key Files

- `src/renderer/components/` (ComparisonView.tsx and sub-components)
- `src/renderer/hooks/useKeyboardShortcuts.ts` (new shortcuts)

## Done When

Divergence points highlighted; metrics show correct deltas; "Next difference" works; 10+ tests.
