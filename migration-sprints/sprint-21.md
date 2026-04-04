# Sprint 21 (Week 34: Aug 17 - Aug 23)

**Phase**: Cleanup
**Theme**: React Performance Patterns

## Deliverables

- [x] Add `useShallow` to ConnectionStatusBadge Zustand selector [FE] [S]
- [x] Convert Button component to `React.forwardRef` for proper ref forwarding [FE] [S]
- [x] Add `useShallow` import to App.tsx root selector [FE] [S]

## Audit Results

- 31/32 files with object selectors already used `useShallow` — only ConnectionStatusBadge was missing
- 17 files use scalar selectors (no `useShallow` needed)
- Button was the only UI primitive missing `forwardRef`

## Key Files

- `src/renderer/components/common/ConnectionStatusBadge.tsx`
- `src/renderer/components/ui/button.tsx`
- `src/renderer/App.tsx`

## Done When

All Zustand object selectors wrapped with `useShallow`; Button supports ref forwarding; 473 tests pass.
