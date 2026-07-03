# Week 5 — Projects JSONL Manager

**Objective:** Give the app's core data source a storage manager: per-project size/age view
of `projects/` (audit: 936 MB, 922 JSONL, 22 project dirs) with bulk archive/trash of old
sessions. Today users must hand-navigate path-encoded dir names (`-Users-name-project`) to
find what is eating the disk.

**Prerequisites:** weeks 1–2 (`ScanCategory`, `TrashItems`, dry-run dialog, watcher mute
window). Existing code this must integrate with — this tree is the app's OWN input:
- `internal/discovery/project_scanner.go:18-74` — project dir scan + path decoding
- `internal/cache` — `SessionCache` (LRU over parsed sessions; trashed sessions must be
  evicted)
- `internal/watcher/runner.go:54` — `projectsDir` is actively watched

## Tickets

### W5-T1 — Per-project storage category
- `CategorySpec` for `projects/`: one entry per project dir (decoded human-readable path via
  the existing `discovery` decoding — do not re-implement), with total bytes, session count,
  newest/oldest session `ModTime`; expandable to per-session candidates (session id, size,
  mtime, message count if cheaply available from cache metadata).
- Age filter (default: sessions older than 90 days) and size sort.
- Cross-reference pinned/hidden sessions from `claude-devtools-config.json`
  (`internal/config`): pinned sessions are excluded from bulk selection by default.
- Verify: fixture projects tree yields correct per-project rollups and per-session candidates.

### W5-T2 — Manager panel
- Panel under `components/maintenance/`: project table (name, sessions, bytes, oldest/newest),
  drill-in to session list with multi-select; dry-run preview (exact resolved JSONL paths +
  bytes + count) → confirm → `TrashItems`.
- Honest labeling: sessions are full conversation content — "Move to trash" verb, trash
  location shown, explicit "Delete permanently (skip trash)" path for sensitive sessions
  (week-2 semantics).
- Never offer same-day/live sessions for bulk selection (the CLI may be appending); the
  ongoing-session detection already in the session pipeline marks these.
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

### W5-T3 — App-integration hygiene
- On trash: evict affected sessions from `SessionCache`, signal the watcher mute window,
  and refresh the sidebar project/session lists once at batch end (not per-file).
- Restore via week-2 UI must reappear in the session list after one rescan.
- Verify: trash → session gone from sidebar without manual refresh; restore → session back
  and parseable (open it — chunks render).

## Exit criteria

- [ ] Per-project totals match `ScanClaudeDir`'s `projects/` entry (live-to-live comparison).
- [ ] Bulk-trash of an old fixture project: one receipt, cache evicted, sidebar updated
      once, no watcher storm.
- [ ] Pinned sessions excluded from bulk selection by default; ongoing sessions never
      selectable.
- [ ] Restore round-trip: session reappears and opens cleanly (parse + chunk render).
- [ ] Permanent-delete path frees bytes (live `ScanClaudeDir` delta).
- [ ] Dry-run preview mandatory; no preview-skipping path exists.
- [ ] Destructive actions dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — `projects/` is the CLI's live session store; trashing a
  session the CLI is appending to corrupts it. Mitigate: ongoing-session exclusion,
  age-based defaults, mute window, and fail-closed confinement from week 2.
- **Breaks the app itself** — this tree is also the app's own input; a stale `SessionCache`
  or a watcher storm during bulk moves shows ghost sessions or refresh flicker. The
  eviction + single-refresh ticket is load-bearing, not cosmetic.
- **Erasure expectations** — session JSONL contains prompts, pasted file contents,
  potentially secrets. Honest trash labeling + permanent-delete path (week 2) apply in full.
- **Path decoding traps** — hyphenated repo names decode ambiguously
  (`-Users-x-my-repo` could be `my/repo` or `my-repo`); reuse `discovery`'s decoder and
  show the RAW dir name alongside the decoded one rather than guessing.
