# Sprint 23 — Week of 2026-06-08 | Analytics

## Session Duration Analytics

### Deliverables
1. **Duration stats** — per-session wall-clock + gap-adjusted active duration. Aggregate: p50/p95/max, outlier flag (>p95 * 1.5).
2. New command `get_session_duration_stats(range)`.
3. `DurationPanel.tsx` — histogram + outlier list (clickable → opens session).
4. Outlier badge on `SessionItem.tsx` when session exceeds p95.

### Files
- `src-tauri/src/analytics/duration.rs` (new — lives in sprint-18's `analytics/` module)
- `src-tauri/src/analytics/mod.rs` (re-export)
- `src-tauri/src/lib.rs`
- `src/renderer/components/dashboard/DurationPanel.tsx` (new)
- `src/renderer/components/dashboard/DashboardView.tsx`
- `src/renderer/components/sidebar/SessionItem.tsx` (badge)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Sprint 21 (active-time calculation)

### Verification
- `cargo test` percentile calc matches reference
- Manual: outlier badge appears/disappears with data
