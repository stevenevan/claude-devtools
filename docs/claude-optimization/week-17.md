# Week 17 — Plugin Enable/Disable + Duplicate Fix

**Objective:** Make `settings.json.enabledPlugins` toggleable in-app and fix the duplicate
the audit found (`chrome-devtools-mcp` enabled under TWO marketplaces —
`@chrome-devtools-plugins` and `@claude-plugins-official`). Today: hand-edit a JSON map.

**Prerequisites:** week 15 (`MutateSettingsJSON`, editor kit). Existing readers:
- `internal/files/pathutil.go:448-474` — `ReadGlobalPlugins` (`installed_plugins.json` +
  `enabledPlugins`)
- `frontend/.../settings/PluginsSettings.tsx` — existing read-only plugins tab
- Week 3's storage panel (cache sizes cross-linked)

## Tickets

### W17-T1 — Typed enabledPlugins patch
- Typed toggle over the `enabledPlugins` map through `MutateSettingsJSON` (the
  settings_write pattern, single mutex): enable/disable = add/remove the
  `plugin@marketplace` key; all
  other settings keys and unknown plugin entries preserved (map-level edit).
- Duplicate detector: same plugin name enabled under multiple marketplaces → surfaced as a
  finding with a one-click "keep this one" dedupe (removes the others; never auto-picks).
- Verify: `go test ./internal/files/...` — toggle + dedupe round-trips preserve unrelated
  keys; disable removes exactly one entry.

### W17-T2 — Plugins tab upgrade
- Extend the existing plugins tab (`PluginsSettings.tsx`, stays under `SettingsTabs.tsx`
  `plugins` entry — no new tab) with `<ConfigEditorShell>`: installed list with enabled
  toggles, marketplace badge, duplicate warning banner with the keep-one picker, and cache
  size per plugin (cross-link to week 3's reclaim panel).
- Disabling does NOT touch caches or `installed_plugins.json` — enable-state only; the
  panel says what disable means (CLI stops loading it; files stay).
- Dual gate: toggles `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Toggle round-trip: disable then enable restores the exact `plugin@marketplace` key;
      unrelated `settings.json` keys untouched at every level (test).
- [ ] Duplicate detection flags multi-marketplace entries from the live file; dedupe keeps
      exactly the chosen one (test).
- [ ] Fresh `claude` session after a disable: plugin not loaded (manual sanity); after
      re-enable: loaded again.
- [ ] `installed_plugins.json` and plugin caches byte-identical before/after any toggle
      (test).
- [ ] Toggles dual-gated; tab's mutating controls `electronOnly: true`.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — a malformed `enabledPlugins` write can fail CLI startup, and
  disabling a plugin that hooks/skills depend on (e.g. LSP plugins) degrades sessions in
  non-obvious ways. `MutateSettingsJSON` atomicity + `.bak` + one-key-at-a-time edits keep
  the blast radius to a single reversible toggle.
- **Dedupe guessing** — the two marketplace copies of a duplicated plugin may differ in
  version/content; auto-picking a survivor could silently downgrade. The keep-one picker
  shows both marketplaces and never chooses for the user.
- **Enable-state vs. installation confusion** — users may expect disable to reclaim disk.
  It doesn't (that's week 3); the explicit "files stay" copy and the cache-size cross-link
  set the expectation.
