# UX-04 — Cost (the Analytics page)

Rail visibility: **simple-rail** ("Cost") · Depends on: 01 · See [README.md](README.md)

## 1. Goal

Answer one question in Simple mode — "what is this costing me?" — and leave the full analytics
workbench intact under Nerd mode.

## 2. Today

Root is `dashboard/AnalyticsDashboard/` — `index.tsx`, `StatCardsRow.tsx`,
`DistributionCharts.tsx`, `TokenUsageBarChart.tsx` — plus the widget panels the page composes:
`BudgetPanel.tsx`, `CostTrendChart.tsx`, `ModelComparisonPanel.tsx`, `ToolAnalyticsPanel.tsx`,
`ToolTimeHeatmap.tsx`, `ErrorClustersPanel.tsx`, `ErrorHotspotsPanel.tsx`,
`ProductivityPanel.tsx`, `DurationPanel.tsx`, with `widgetRegistry.ts`, `widgetContract.ts`,
`useWidgetVisibility.ts` and `DashboardCustomizeMenu.tsx` behind the customisation.

Problems for a non-technical reader:

- **Three of the five stat cards are token metrics.** `StatCardsRow.tsx:38-67` leads with
  "Total Tokens", then "Total Cost", "Sessions", "Avg Tokens/Session", and a peak bucket. For the
  target audience, four of those five are noise and one is the answer.
- **The page is titled "Analytics"** (`index.tsx:82, 114`) — a category, not a question.
- **Chart subtitles are analyst copy.** "Week-over-week spend with per-period breakdown"
  (`index.tsx:172`) is precise and unreadable.
- **Nine-plus widgets with a customisation menu.** Error clusters, error hotspots, tool-time
  heatmap, model comparison, productivity, duration outliers. Every one is a real power-user tool
  and every one is a reason for a beginner to close the page.
- **No answer to "is this a lot?"** Cost is reported without a reference point — no budget
  context in the Simple path, even though `BudgetPanel.tsx` exists.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Cost                                                        |
|                                                              |
|      This month                                              |
|                                                              |
|          $12.40                                              |
|                                                              |
|      Last month was $9.10  ·  up about a third               |
|                                                              |
|  +--------------------------------------------------------+  |
|  |  ###                                                   |  |
|  |  ### ###           ###                                 |  |
|  |  ### ### ###   ### ###  ###                            |  |
|  |  Mar Apr May Jun Jul                                   |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Where it went                                               |
|    my-project           $8.20                                |
|    another-project      $3.10                                |
|    everything else      $1.10                                |
|                                                              |
+--------------------------------------------------------------+
```

Rules:

- **One number, large.** This month's spend. Everything else supports it.
- One comparison sentence against last month, in words as well as figures.
- One chart: spend over time. No stacked series, no per-model split, no dual axis.
- One breakdown: cost per folder, top three plus "everything else".
- **No token figures anywhere.** Not in a subtitle, not in a tooltip.
- If a budget is set in `BudgetPanel`, Simple mode says how much of it is used — that is the
  "is this a lot?" answer. If none is set, it offers to set one, once, without nagging.
- No widget customisation menu.

## 4. Nerd view

Today's page, unchanged: five stat cards, every widget, the customisation menu, distribution
charts, the token bar chart, the tool-time heatmap, model comparison, error clusters and hotspots.

Additions: chart subtitles keep their precision but gain an accessible summary, and the
customisation menu's widget names get one-line descriptions so a new power user knows what
"Error Clusters" means.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Analytics | Cost | Analytics |
| Total Tokens | — (hidden) | Total Tokens |
| Total Cost | This month | Total Cost |
| Avg Tokens/Session | — (hidden) | Avg Tokens/Session |
| Sessions | conversations (in the breakdown only) | Sessions |
| Week-over-week spend with per-period breakdown | "Spending over time" | as today |
| Session Activity Timeline | — (hidden) | Session Activity Timeline |
| Model Comparison | — (hidden) | Model Comparison |
| Error Clusters / Error Hotspots | — (hidden) | as today, with descriptions |
| Tool Time Heatmap | — (hidden) | Tool Time Heatmap |
| Peak bucket | — (hidden) | as today |
| Budget | "Monthly limit" | Budget |

## 6. Files touched

- `frontend/src/renderer/components/dashboard/AnalyticsDashboard/index.tsx`
- `frontend/src/renderer/components/dashboard/AnalyticsDashboard/StatCardsRow.tsx`
- `frontend/src/renderer/components/dashboard/CostSummary.tsx` **(new)** — the Simple view
- `frontend/src/renderer/components/dashboard/BudgetPanel.tsx` — the Simple budget line
- `frontend/src/renderer/components/dashboard/dashboardFormatters.ts` — the shared cost formatter
- `frontend/src/renderer/components/dashboard/DashboardCustomizeMenu.tsx` — widget descriptions
- `frontend/src/renderer/components/dashboard/widgetRegistry.ts` — a `nerdOnly` flag if the
  registry is the cleanest place to express which widgets Simple mode omits

Chart work uses whatever charting library the page already uses. Do not add a second one.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `widgetRegistry.ts` / `widgetContract.ts` / `useWidgetVisibility.ts` and decide whether
   Simple mode is a separate component or a registry filter. Prefer the registry if it already
   models visibility — one mechanism, not two.
2. Confirm the cost formatter agreed in sprint 02 task 1 and use it here. One money formatter in the
   codebase.
3. `CostSummary.tsx` — the headline number, the comparison sentence, one chart, the folder
   breakdown.
4. Branch `AnalyticsDashboard/index.tsx` on `useUIMode()`.
5. Budget line in Simple when a budget exists; a single non-repeating offer when it does not.
6. Empty state: no data yet, in plain language.
7. Nerd mode: widget descriptions in the customisation menu, accessible chart summaries.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`

Simple mode:

- The word "token" appears nowhere on the page, including tooltips and chart axes.
- One headline figure, one chart, one breakdown. Nothing else.
- With a budget set, the page says how much of it is used.
- With no sessions at all, the page explains that rather than rendering empty axes.
- The comparison sentence is correct for a month with no prior month (it says so, rather than
  dividing by zero).

Nerd mode:

- Every widget still available and still customisable; the page matches today.

## 9. Accessibility

- The headline figure is a heading, so it is reachable by heading navigation.
- Every chart has a text alternative — a short summary of the trend, not just an `aria-label`
  restating the title. Data is also available as a table in Nerd mode.
- Colour is never the only way to tell series apart; the Simple chart is single-series precisely
  to avoid this.
- Figures use `tabular-nums` so they align, and are readable at 200% zoom.

## 10. Dependencies

Sprint 01 (`useUIMode()`). Shares sprint 02's cost formatter.

## 11. Risks / open questions

- **Cost accuracy is the whole page.** If cost is derived from tokens and a rate table, the rate
  table's provenance matters — a wrong rate makes a confidently wrong headline number. Find where
  the existing `formatCost` gets its figures (`StatCardsRow.tsx:45-47` already renders one) and
  reuse that path rather than computing a second one. If the existing figure is itself an estimate,
  Simple mode says "about $12.40", not "$12.40".
- "Up about a third" is a judgement in words. Keep the thresholds simple and state them in the
  code, so two months apart do not produce contradictory phrasing.
- Hiding widgets in Simple mode must not break `useWidgetVisibility`'s persisted state — a user
  switching to Nerd should find their widget layout as they left it.
