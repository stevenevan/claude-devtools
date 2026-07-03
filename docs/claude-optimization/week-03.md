# Week 3 — Plugin Cache & Marketplaces Cleanup

**Objective:** Reclaim the single largest chunk of `~/.claude` (audit: `plugins/cache`
1.3 GB, `plugins/marketplaces/` 87 MB, `plugins/repos/` empty) via a per-plugin cache
browser with safe, restorable removal. Today this is `rm -rf` guesswork with no way to see
what a marketplace or cached repo costs.

**Prerequisites:** weeks 1–2 (`ScanClaudeDir`, `ScanCategory`, `TrashItems` + dry-run
confirm dialog). Existing readers:
- `internal/files/pathutil.go:448-474` — `ReadGlobalPlugins` (`installed_plugins.json` +
  `enabledPlugins` from `settings.json`)

## Tickets

### W3-T1 — Plugin storage category spec
- `CategorySpec` for `plugins/`: per-marketplace and per-cached-repo entries with size,
  file count, `ModTime`, and an `enabled` cross-reference against `enabledPlugins`
  (a cached repo whose plugin is not enabled anywhere is a prime reclaim candidate).
- `ScanCategory` output drives the UI; no plugin-specific delete code — candidates feed
  `TrashItems` verbatim.
- Flag anomalies for the UI: `repos/` empty while `cache/` holds gigabytes (broken/legacy
  layout worth surfacing, not silently "fixing").
- Verify: `go test ./internal/maintenance/...` — fixture plugins tree yields expected
  candidates with enabled/disabled cross-refs.

### W3-T2 — Plugins storage panel
- New panel under `components/maintenance/`: table of marketplaces + cached repos (name,
  size, last modified, enabled-by), sorted by size; multi-select → dry-run preview (exact
  resolved paths + bytes + count from `ScanCategory`) → confirm → `TrashItems`.
- Cached data for an ENABLED plugin gets a warning badge: removal is safe (cache
  re-downloads) but forces a re-fetch on next use — say so.
- Link from the existing Plugins settings tab (`SettingsTabs.tsx` `plugins` entry) to this
  panel; keep enable/disable OUT of scope (that is week 17, a `settings.json` write).
- Dual gate: destructive actions `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

### W3-T3 — Post-trash verification
- After a trash batch, re-run the category scan and show reclaimed bytes (live delta from
  `ScanCategory`, not the pre-computed estimate).
- Verify: reclaimed bytes reported == receipt `Items` byte sum.

## Exit criteria

- [ ] Category scan lists every marketplace + cached repo with size/mtime/enabled-by; totals
      match `ScanClaudeDir`'s `plugins/` entry (live outputs compared, no frozen numbers).
- [ ] Trashing a disabled plugin's cache moves it under `<appdata>/trash/<receiptID>/` with
      a valid manifest; `RestoreTrash` brings it back byte-identical (test).
- [ ] Dry-run preview shows exact paths + bytes before any confirm; nothing moves without it.
- [ ] Enabled-plugin cache removal shows the re-download warning.
- [ ] `plugins/repos/`-empty anomaly surfaced as an informational badge, not auto-deleted.
- [ ] Destructive actions dual-gated (`electronOnly` + `connectionMode === 'local'`).
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — deleting the cache of an enabled plugin mid-session can fail a
  running `claude` invocation that expects the cached repo (it re-downloads on next start,
  but in-flight use may error). Mitigate: warning badge on enabled plugins; never touch
  `installed_plugins.json` or `settings.json.enabledPlugins` this week (read-only
  cross-reference only).
- **Cache vs. config confusion** — `plugins/cache` is regenerable, but the temptation to
  "also clean up" `installed_plugins.json` crosses into config writes that belong to week 17
  with the settings_write pattern. Scope fence: this week moves files, never edits JSON.
- **Marketplace identity** — the same plugin can be cached under two marketplaces (audit
  found `chrome-devtools-mcp` enabled twice). Removing one cache while the duplicate entry
  still points at it is safe (re-download) but confusing; surface the duplication badge,
  defer the fix to week 17.
