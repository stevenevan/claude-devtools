# Week 15 — Config-Write Foundation + Settings Diff/Restore

**Objective:** Build the substrate every config editor (weeks 16–28) reuses — the extracted
Go mutator, the shared frontend editor kit, and config-file watching — and ship the first
consumer: a visual diff of the three divergent `settings.json` generations found in the
audit (`settings.json` vs `.bak` vs `.pre-ponytail`) with one-click restore.

**Prerequisites:** weeks 1–2 (resolvers, maintenance view). Existing code this week extracts
from / extends:
- `internal/files/settings_write.go` — the existing settings editor's write path
  (`settingsWriteMu:20`, read-fresh, `.bak`, temp+rename) — the **settings_write pattern**
- `internal/watcher/runner.go:54` — watches only `projectsDir`/`todosDir` today
- `frontend/src/renderer/components/settings/SettingsTabs.tsx` — `electronOnly` tab gating

## Tickets

### W15-T1 — Extract `files.MutateSettingsJSON`
- New exported helper in `internal/files`:
  `MutateSettingsJSON(mutate func(m map[string]any) error) error` — owns the SINGLE
  `settingsWriteMu`, read-fresh-at-write-time, corrupt-JSON → error-and-don't-touch, `.bak`
  before write, `MarshalIndent` → temp+rename. Refactor the existing
  `UpdateGlobalSettings` to CALL it (behavior identical; existing
  `internal/files/settings_write_test.go` must stay green unchanged).
- This is the ONLY function that writes `settings.json` from now on; weeks 16/17/19/23 pass
  mutate callbacks. One file, one lock — a copied pattern is not the same mutex.
- Verify: `go test ./internal/files/...` green including all pre-existing settings_write
  tests.

### W15-T2 — Shared frontend editor kit
- Under `frontend/src/renderer/components/maintenance/`:
  - `useFileBackedEditor` hook — load → edit → validate → save → toast, dirty-state, error
    surface; save calls an injected API fn (each week supplies its typed patch call).
  - `<ConfigEditorShell>` — layout chrome (title, dirty badge, Save/Discard via the `Button`
    component, error banner).
  - `<JsonDiffView>` — two-pane structural JSON diff (added/removed/changed keys, theme
    `--diff-*` vars).
- No `useCallback`/`React.memo`; no JSDoc; Tailwind theme classes only.
- Verify: `bunx tsc --noEmit`; kit unit tests (dirty-state transitions, validate-blocks-save).

### W15-T3 — Watcher extension to config files
- Extend `watcher.Runner` to optionally watch `settings.json` and `~/.claude.json` (single
  files, debounced like the existing dirs) emitting a `config-file-change` event. Consumers
  this week: the diff view refreshes when the CLI writes settings underneath it. Weeks 20
  and 32 (drift alerts) reuse this.
- Verify: touching `settings.json` externally fires one debounced event (test).

### W15-T4 — Settings generations diff + restore
- Panel (new `claudeCode`-adjacent settings tab or maintenance panel — follow
  `SettingsTabs.tsx` conventions, `electronOnly: true`): pick any two of
  `settings.json` / `settings.json.bak` / `settings.json.pre-ponytail` → `<JsonDiffView>`.
  Audit showed real divergence (missing `model`, `theme`, dropped env keys) — this replaces
  hand-diffing JSON.
- **Restore** = copy chosen generation over `settings.json` THROUGH `MutateSettingsJSON`
  (mutate callback replaces the full map) so the current file lands in `.bak` first and the
  write is atomic. Confirm dialog lists the top-level keys that will change.
- Dual gate: restore `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: restore fixture round-trip; `.bak` holds pre-restore content.

## Exit criteria

- [ ] `MutateSettingsJSON` extracted; existing settings-editor behavior unchanged (all
      pre-existing Go tests green without edits).
- [ ] Editor kit exports exactly `useFileBackedEditor`, `<ConfigEditorShell>`,
      `<JsonDiffView>`; kit tests green.
- [ ] External `settings.json` edit fires `config-file-change` and refreshes the diff view.
- [ ] Diff of live generations renders key-level changes; restore writes atomically with
      pre-restore `.bak` (test).
- [ ] Corrupt target file → restore errors, file untouched (test).
- [ ] Restore dual-gated; tab `electronOnly: true`.
- [ ] `go test ./internal/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — restoring an old generation can resurrect stale
  `enabledPlugins`/`hooks` or drop keys the CLI has since written; a malformed write blocks
  CLI launch. Mitigations: everything through `MutateSettingsJSON` (atomic, `.bak`,
  corrupt-abort), key-change confirm dialog, and the CLI-rewrites-this-file warning in copy.
- **Two-mutex trap** — if any later week copies the pattern instead of calling the helper,
  concurrent writers race and lost-updates return. Review gate: `settings.json` writes
  outside `MutateSettingsJSON` are rejected on sight.
- **Foundation slippage** — 13 later weeks consume this kit; a half-baked
  `useFileBackedEditor` API gets frozen by copies. Kit API review with week-16/23 use cases
  sketched BEFORE merge.
