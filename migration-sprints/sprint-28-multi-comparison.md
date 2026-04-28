# Sprint 28 — Week of 2026-07-13 | Playback

## Multi-Session Comparison Matrix

### Deliverables
1. **Multi-compare view** — extend `SessionComparison.tsx` to accept 3–5 sessions; render columns side-by-side with synchronized scroll.
2. Divergence marker rail: highlights rows where >=1 session differs vs. the first.
3. Add-session picker in comparison header (dropdown of recent sessions).

### Files
- `src/renderer/components/chat/SessionComparison.tsx`
- `src/renderer/components/chat/SessionComparisonColumn.tsx` (new — extracted)
- `src/renderer/utils/comparisonAlignment.ts` (new — n-way LCS)
- `src/renderer/store/slices/tabSlice.ts` (trim — split triggered here)
- `src/renderer/store/slices/comparisonTabSlice.ts` (new — extracted; holds comparison list and alignment state)

### Dependencies
- Existing `SessionComparison` (2-way diff)

### Prerequisite
`tabSlice.ts` (~733 lines) approaches 800 cap; this sprint triggers the split into `tabSlice.ts` + `comparisonTabSlice.ts` (architect directive #5). Do the split as the first commit in the sprint.

### Verification
- Unit test: n-way alignment matches 2-way on N=2
- Manual: 4-session compare scrolls in lockstep; divergence markers correct
