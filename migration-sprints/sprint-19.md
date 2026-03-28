# Sprint 19 (Week 32: Aug 3 - Aug 9)

**Phase**: 5 - Polish & Accessibility
**Theme**: Performance Optimization & Bundle Analysis

## Deliverables

- [ ] Bundle analysis + code splitting — `vite-bundle-visualizer`, lazy-load dashboard/settings/comparison, lazy recharts/react-markdown/diff viewer [FE] [L]
- [ ] Memoization audit — React DevTools profiling, `React.memo` on expensive components, `useMemo`/`useCallback` fixes [FE] [L]
- [ ] Final integration test sweep — 5 critical flows (open session, search, compare, stream, bookmarks/tags) [FE+BE] [M]
- [ ] Performance baseline documentation — startup, session load, search, streaming latency, bundle size, memory for 100/1K/10K messages [FE+BE] [M]

## Key Files

- `vite.config.ts` (code splitting)
- `src/renderer/components/chat/ChatHistory.tsx` (memoization)
- `src/renderer/components/dashboard/AnalyticsDashboard.tsx` (lazy load)
- `src/renderer/utils/aiGroupEnhancer.ts` (memoization)

## Done When

Bundle size reduced 15%+ via code splitting; no component re-renders > 2x per state change; 5 critical flow tests pass; baselines documented.
