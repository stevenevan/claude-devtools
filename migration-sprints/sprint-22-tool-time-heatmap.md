# Sprint 22 — Week of 2026-06-01 | Analytics

## Tool Usage Heatmap by Time-of-Day

### Deliverables
1. **Backend bucketing** — extend `tool_analytics.rs` to emit `HourOfDay x DayOfWeek` counts. New command `get_tool_time_heatmap(range)`.
2. `ToolTimeHeatmap.tsx` — 7x24 grid, colour intensity = call count; hover shows count + top tool.
3. Filter: tool name dropdown (reuses existing tool list).

### Files
- `src-tauri/src/analysis/tool_analytics.rs`
- `src-tauri/src/lib.rs`
- `src/renderer/components/dashboard/ToolTimeHeatmap.tsx` (new)
- `src/renderer/components/dashboard/ToolAnalyticsPanel.tsx` (mount heatmap tab)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Sprint 1–2 (ToolAnalytics backend + panel)

### Verification
- `cargo test` bucketing with DST/timezone edge cases (use chrono `Local`)
- Manual: heatmap in dark/light theme
