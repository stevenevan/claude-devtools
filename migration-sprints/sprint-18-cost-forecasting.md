# Sprint 18 — Week of 2026-05-04 | Analytics

## Token/Cost Forecasting + DashboardWidget Contract

### Deliverables
1. **Analytics module split (prerequisite)** — `src-tauri/src/analytics.rs` (currently 1021 lines) exceeds the 800-line cap. Refactor into `src-tauri/src/analytics/` directory: `mod.rs` re-exports + move cost, tool-analytics, error-hotspot aggregators into sibling files (`cost.rs`, `tools_summary.rs`, `errors_summary.rs`). No behavioral change; callers in `commands.rs` continue to compile.
2. **Forecast engine** — new `analytics/forecasting.rs`: linear regression over trailing N session-day cost totals. Output `{ projected_daily_cost_usd, projected_weekly_cost_usd, trend_slope_usd_per_day }`.
3. **Command** — `get_cost_forecast(window_days: u32) -> CostForecast` registered in `lib.rs`.
4. **Budget config fields** — `daily_budget_usd: Option<f64>`, `weekly_budget_usd: Option<f64>` added to `AppConfig`; no alerting yet (deferred to sprint 20 once notification action plumbing is touched).
5. **`DashboardWidget` interface stub** — new `src/renderer/components/dashboard/widgetContract.ts`: exports `DashboardWidgetMeta { id, title, category, defaultSize, minSize, maxSize, defaultVisible, onMount?, onUnmount? }` and `registerDashboardWidget()` no-op placeholder. Full shape declared now so sprints 19–25 populate every field and sprint 32 has zero retroactive widget refactor (architect directive #2 + #8).
6. `BudgetPanel.tsx` — dashboard card: current-period spend, projected spend, trend arrow. Registers via `registerDashboardWidget`.

### Files
- `src-tauri/src/analytics.rs` → split into `src-tauri/src/analytics/` (new dir) with `mod.rs`, `cost.rs`, `tools_summary.rs`, `errors_summary.rs`, `forecasting.rs` (new)
- `src-tauri/src/commands.rs` (import paths updated)
- `src-tauri/src/config/types.rs` (budget fields)
- `src-tauri/src/lib.rs` (register `get_cost_forecast`)
- `src/renderer/components/dashboard/widgetContract.ts` (new)
- `src/renderer/components/dashboard/BudgetPanel.tsx` (new)
- `src/renderer/components/dashboard/DashboardView.tsx` (mount)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Sprint 9 (cost trend data already flowing through `analytics.rs`)
- No notification backend changes in this sprint (carve-out per metis directive)

### Verification
- `cargo test` — forecast math: `[10, 12, 14, 16]` cost series projects `slope ≈ 2.0`, daily ≈ 18
- `cargo check` passes after module split
- `bun run typecheck` clean; `bun run lint:fix` clean
- Manual: dashboard shows projected spend column; no budget alerts yet (by design)

### Out of Scope (explicit)
- Budget breach notifications — deferred until notification action plumbing is already open in later sprint
- Widget registry runtime (sprint 32); this sprint only publishes the type + no-op `register` seam
