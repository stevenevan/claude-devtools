# Week 31 — Retention Policy Engine

**Objective:** Compose the per-surface cleanups (weeks 3–8, 10–11) into named retention
policies with a one-click **Clean now**: every category's cutoffs (already persisted
piecemeal in `claude-devtools-config.json` by weeks 6, 9, 11) unified into one policy model,
executed in one reviewed pass — all destructive work still via `TrashItems`. Plus the piece
week 2 deferred here: **trash auto-expiry**, so the trash itself is finally governed.

**Prerequisites:** weeks 2–11 (every category spec + the trash engine), week 13
(notifications auto-prune joins as an app-owned category). No new deletion mechanics — this
week is composition only.

## Tickets

### W31-T1 — Policy model
- One policy document in `claude-devtools-config.json` (existing `internal/config` atomic
  writer): per-category enable + cutoff — plugin caches (3), transcripts (4), old sessions
  (5), file-history (6), backup binaries (7), junk (8), history.jsonl (10), runtime state
  (11), **trash expiry (receipts older than N days → `EmptyTrash`, default 30)**.
  Plain-delete categories (logs 9, caches 12, notifications 13) keep their own knobs where
  they live; the policy panel links to them rather than absorbing their different delete
  semantics.
- Migrate the piecemeal cutoffs weeks 6/11 already stored into the unified shape (one-time,
  additive).
- Verify: policy round-trips through config; migration test from the piecemeal keys.

### W31-T2 — Clean-now execution
- Executor in `internal/maintenance`: run every enabled category's `ScanCategory`,
  aggregate candidates into ONE combined dry-run report (per-category counts + bytes +
  expandable path lists), one confirm, then sequential `TrashItems` per category (one
  receipt per category — restore stays granular). Trash expiry runs LAST (`EmptyTrash` on
  expired receipts) so a same-pass mistake is still restorable until the next pass.
- Progress via the week-1 `maintenance:scan-progress` event convention; cancellable between
  categories.
- On completion: update `.last-cleanup` semantics? No — that file is CLI-owned; the app
  records its own last-run timestamp in `claude-devtools-config.json` and the week-14
  health panel shows both.
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: fixture ~/.claude exercising all categories in one pass — receipts per category,
  expiry last, cancel between categories leaves completed categories done.

### W31-T3 — Policy panel
- Panel under `components/maintenance/`: category rows (enable, cutoff, live candidate
  preview count via `ScanCategory`), the combined dry-run report, Clean now with confirm,
  last-run summary. Scheduling is NOT here (week 32) — manual trigger only.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] One Clean-now pass on the fixture executes every enabled category via `TrashItems`,
      one receipt each; disabled categories untouched (test).
- [ ] Trash expiry `EmptyTrash`es only receipts older than the cutoff, and runs last
      (test).
- [ ] Combined dry-run report precedes execution; cancel between categories is clean
      (test).
- [ ] Candidate counts in the panel are live `ScanCategory` outputs (no frozen numbers).
- [ ] Piecemeal cutoffs from weeks 6/11 migrate into the policy once, losslessly (test).
- [ ] Execution dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — a combined pass multiplies every per-category risk in one
  click: live-session files, CLI-recreated dirs, binaries. The mitigations are inherited,
  not new — per-category live-file exclusions, the combined preview, per-category receipts
  — plus expiry-runs-last so even a bad pass is restorable until the NEXT pass.
- **Policy autopilot drift** — a policy set once and forgotten deletes by stale intent
  months later. The manual-trigger-only rule this week (and the preview even on Clean now)
  keeps a human between policy and disk; week 32 adds scheduling with its own consent
  gates.
- **Composition bugs** — categories were built and tested solo; interactions (junk sweep
  emptying a dir that runtime-GC then lists, expiry racing a same-pass restore) appear only
  composed. The all-categories fixture test exists precisely for these seams.
