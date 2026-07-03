# Week 29 — Plans Browser

**Objective:** Surface `~/.claude/plans/` (audit: a handful of files, oldest from 2025-11,
including orphaned agent variants) — plan documents the CLI writes during plan mode and
never cleans up. View, stale-flag, and delete via trash.

**Prerequisites:** weeks 1–2 (`ScanCategory`, `TrashItems`). The existing markdown render
pipeline (chat viewers) is reused for display.

## Tickets

### W29-T1 — Plans category spec
- `CategorySpec` for `plans/`: per-file entries (name, bytes, `ModTime`), staleness by age
  cutoff (default 60 days — a plan untouched for two months is done or abandoned), and
  variant grouping: files sharing a base name (plan + its agent-variant siblings) grouped
  so they're reviewed together.
- Verify: fixture plans dir yields correct groups + stale flags from live mtimes.

### W29-T2 — Browser panel
- Panel under `components/maintenance/`: plan list (name, age, size, stale badge, variant
  group), click-through to rendered markdown (existing prose pipeline, read-only), and
  delete: multi-select → dry-run preview → `TrashItems` (user-authored planning content —
  trash policy, restorable).
- No editing — plans are historical artifacts of past sessions; an editor would invite
  rewriting history for no workflow gain (create/edit belongs to the CLI's plan mode).
- Dual gate: deletes `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Plans listed with live age/size; stale badges from live `ModTime` vs cutoff, variant
      groups correct (fixture tests; no frozen audit dates).
- [ ] Rendered plan view uses the existing markdown pipeline (no new renderer).
- [ ] Delete round-trips through trash; restore returns the file to `plans/` and it
      re-lists (test).
- [ ] Dry-run preview mandatory before delete; panel exposes no edit affordance (review
      gate).
- [ ] Deletes dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — low here, but real at the margin: plan mode may re-open a
  recent plan file; trashing one mid-session breaks that resume. The age cutoff keeps
  candidates cold, today's files are never offered (week-11 convention), and trash makes a
  wrong guess a one-click restore.
- **Stale ≠ worthless** — an old plan can be the only record of a design decision. Stale is
  a BADGE, not a preselection; nothing is checked by default, and the rendered view lets
  users read before deleting.
- **Variant blindness** — deleting a plan while keeping its orphaned agent variant recreates
  the audit's clutter in reverse; variant grouping keeps siblings visible in one decision.
