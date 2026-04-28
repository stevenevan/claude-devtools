# Sprint 21 — Week of 2026-05-25 | Analytics

## Productivity Metrics Dashboard

### Deliverables
1. **Rust metrics aggregator** — per-day: sessions started, sessions completed, total active minutes (gap-adjusted), total tool calls, tokens per session p50/p95. New command `get_productivity_metrics(range)`.
2. `ProductivityPanel.tsx` — dashboard card with 4 KPIs + sparkline per KPI.
3. Week-over-week delta badges (reuse styling from `CostTrendChart`).

### Files
- `src-tauri/src/analytics/productivity.rs` (new — lives inside sprint-18's `analytics/` module)
- `src-tauri/src/analytics/mod.rs` (re-export)
- `src-tauri/src/lib.rs`
- `src/renderer/components/dashboard/ProductivityPanel.tsx` (new)
- `src/renderer/components/dashboard/DashboardView.tsx`
- `src/renderer/hooks/useAnalyticsData.ts` (new query hook)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Existing `analysis/timeline_gap_filling.rs` for active-time calc
- Sprint 9 style patterns (sparkline reuse)

### Verification
- `cargo test` gap-adjusted active time calc
- Manual: panel updates within 1s on session import
