# Sprint 24 — Week of 2026-06-15 | Analytics

## Model Performance Comparison Dashboard

### Deliverables
1. **Per-model metrics** — cost/token, tokens/session, tool-calls/session, error rate, avg response latency. Group by model id from existing `modelParser.ts`.
2. New command `get_model_comparison(range)`.
3. `ModelComparisonPanel.tsx` — side-by-side table with sortable columns, sparkline per metric.

### Files
- `src-tauri/src/analytics/model_comparison.rs` (new — lives in sprint-18's `analytics/` module)
- `src-tauri/src/analytics/mod.rs` (re-export)
- `src-tauri/src/lib.rs`
- `src/renderer/components/dashboard/ModelComparisonPanel.tsx` (new)
- `src/renderer/components/dashboard/DashboardView.tsx`
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Sprint 9 (cost data)
- Sprint 1 (tool analytics)
- Existing `src/shared/utils/modelParser.ts`

### Verification
- `cargo test` aggregation groups correct models (opus vs sonnet vs haiku)
- Manual: sort by column persists across tab switches
