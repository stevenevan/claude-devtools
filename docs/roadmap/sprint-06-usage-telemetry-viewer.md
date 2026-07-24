# Sprint 06 — Usage / Telemetry Raw Viewer

## 1. Goal
Surface the raw usage/telemetry data the CLI keeps locally — `~/.claude/stats-cache.json`,
`~/.claude/statsig/`, `~/.claude/telemetry/*.json` — which today has **no in-app viewer**.

## 2. Gap addressed
Usage stats / telemetry (gap matrix #11). Today `cat_caches.rs` + `maintenance/CachesCleanupPanel.tsx`
only clean them, and the panel explicitly states "there is no in-app raw-JSON viewer for it." The
existing `AnalyticsDashboard` derives from session JSONL, **not** from `stats-cache.json`. Verified
`stats-cache.json` keys: `dailyActivity, dailyModelTokens, hourCounts, modelUsage, longestSession,
totalSessions, totalMessages, firstSessionDate, lastComputedDate, version`. `telemetry/` holds
`1p_failed_events.*.json` payloads.

## 3. Backend
- New `src-tauri/src/files/usage_reader.rs`:
  - `pub fn read_usage_stats(root: &str) -> Result<serde_json::Value, String>` — read + parse
    `stats-cache.json` (return the structured object; tolerate missing keys).
  - `pub fn list_telemetry_events(root: &str) -> Result<Vec<TelemetryMeta>, String>` — dir-walk
    `telemetry/*.json` → `TelemetryMeta { name, size_bytes, mtime }`.
  - `pub fn read_telemetry_event(root: &str, name: &str) -> Result<serde_json::Value, String>` —
    confined read of one `telemetry/` file; confine `name`.
- Wrappers in `src-tauri/src/commands/files.rs`; register in `main.rs` `generate_handler!`.

## 4. Frontend
- New `frontend/src/renderer/components/dashboard/UsageStatsPanel.tsx` — ActivityBar view
  `activity="usage"` (or a Maintenance panel if lighter fit). Render `stats-cache.json` structured:
  reuse `AnalyticsDashboard/` chart subcomponents for `dailyActivity`/`modelUsage`/`hourCounts`
  where they map cleanly, plus a labeled key/value block for scalar fields.
- Telemetry: a list (`list_telemetry_events`) + a raw-JSON viewer for a selected event (reuse
  `JsonDiffView.tsx` single-side rendering, or a JSON tree view).
- API: `usage` domain method(s); type `frontend/src/shared/types/api/usage.ts`
  (`TelemetryMeta`; `stats-cache` typed loosely as a structured record given drift).

## 5. Tasks (ordered)
1. Backend readers → `cargo test usage_reader` (parse real `stats-cache.json` shape; tolerate a
   missing key).
2. Command wrappers + `main.rs` registration → `bun run test:rust`.
3. Shared types + API adapter → `bun run typecheck`.
4. `UsageStatsPanel.tsx` — structured stats (reusing analytics charts) + telemetry raw viewer.

## 6. Verification / acceptance
- `cargo test usage_reader` — parses a `stats-cache.json` fixture including one with a dropped key
  (no panic); `read_telemetry_event` rejects a traversal `name`.
- `bun run typecheck && bun run test && bun run qa` green.
- Manual: open Usage; stats render; a telemetry event opens as raw JSON.

## 7. Dependencies
None. **Non-goal:** this does not replace or re-derive `AnalyticsDashboard` — it shows the CLI's own
raw stats alongside it.

## 8. Drift / risk notes
- `stats-cache.json` / telemetry schemas are version-specific — type loosely, render tolerant,
  `// confirm-at-impl`. `statsig/` may be empty on some machines; handle an absent dir gracefully.
