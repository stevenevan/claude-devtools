# Week 4 — Stale Transcripts Pruner

**Objective:** Reclaim the `transcripts/` tree (audit: 620 MB, 2,215 `ses_*` JSONL files,
nothing written in ~4.5 months) with an age-based pruner. This is the program's cleanest
big win: machine-generated, apparently abandoned by the CLI, and invisible without a UI.

**Prerequisites:** weeks 1–2 (`ScanCategory`, `TrashItems`, dry-run confirm dialog,
watcher mute window).

## Tickets

### W4-T1 — Age-based category spec
- `CategorySpec` for `transcripts/`: candidates older than a user-chosen cutoff (default
  90 days by `ModTime`), grouped by month, each with size + count. Live `ModTime` decides
  staleness — never a hardcoded "stale since 2026-02" assumption from the audit; if the CLI
  resumes writing transcripts tomorrow, fresh files simply drop out of the candidate list.
- An "entire tree is stale" fast-path: when the newest file is older than the cutoff, offer
  a single select-all group.
- Verify: fixture tree with mixed mtimes yields correct month buckets and cutoff filtering.

### W4-T2 — Pruner panel
- Panel under `components/maintenance/`: cutoff selector, month-bucket list (period, files,
  bytes), select-all per bucket; dry-run preview (exact paths + bytes + count from
  `ScanCategory`) → confirm → `TrashItems`. No "select-all → delete" shortcut that skips the
  preview.
- Honest labels: "Move to trash" + trash location; "Delete permanently (skip trash)" as the
  explicit second path — transcripts are conversation content; users deleting them may
  intend erasure (week 2 semantics).
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

### W4-T3 — Post-prune report
- Reclaimed bytes from the live `ScanCategory` re-run; receipt visible in the week-2 trash
  UI for restore.
- Verify: restore of a pruned month-bucket returns every file to its exact `OrigPath`.

## Exit criteria

- [ ] Candidates computed from live `ModTime` against the cutoff; count/bytes shown match a
      `find -mtime` cross-check on the fixture (live outputs, no frozen audit numbers).
- [ ] Dry-run preview precedes every prune; aborting the confirm moves nothing.
- [ ] Pruned files land under one `TrashReceipt`; `RestoreTrash` round-trips a sample
      byte-identical (test).
- [ ] Permanent-delete path works and frees bytes (live `ScanClaudeDir` delta).
- [ ] Prune of hundreds of files raises no watcher-driven refresh storm (mute window held).
- [ ] Destructive actions dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — if a future CLI version resumes writing `transcripts/` (the
  dir was active until recently), pruning a file mid-write could corrupt an in-flight
  transcript. Mitigate: age cutoff (default 90 days) means candidates are months cold; the
  watcher mute window covers the app's own churn; never prune files younger than the cutoff
  regardless of select-all.
- **"Stale forever" assumption** — the audit's "nothing since 2026-02" is a snapshot, not a
  contract. The category spec re-derives staleness from live mtimes on every scan; the UI
  must not bake in the audit's dates.
- **Erasure expectations** — transcripts are full conversation logs. Trash-not-delete
  extends retention of data the user may intend to destroy; the explicit permanent-delete
  path and honest labeling are the mitigation, not optional polish.
