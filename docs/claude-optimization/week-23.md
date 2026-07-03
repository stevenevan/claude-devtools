# Week 23 — env Flags Editor

**Objective:** Upgrade the raw KEY/value env editing the existing settings editor shipped
into a known-flag toggle surface over `settings.json.env` — the audit found flags like
concurrency limits, streaming toggles, and telemetry opt-outs being flipped by hand-editing
JSON. Unknown keys keep the raw row editor; known flags get typed controls.

**Prerequisites:** week 15 (`MutateSettingsJSON`, `useFileBackedEditor`). Existing code this
extends (not replaces):
- `internal/files/settings_write.go` — the existing settings editor already round-trips
  `env` via a typed patch
- The existing `ClaudeCodeSection` settings UI (env rows + permissions lists)

## Tickets

### W23-T1 — Known-flag catalog
- A small, static catalog (Go or TS constant — no config file, no registry abstraction) of
  well-known `env` keys: name, value type (bool "1"/"0", int, enum), one-line description,
  and default. Seed it with the flags observed in the audit + documented CLI env vars;
  unknown keys are NOT in the catalog and fall through to raw rows.
- The catalog is display metadata only — writes remain plain string KEY/value pairs through
  the existing typed env patch and `MutateSettingsJSON` (settings_write pattern; values are
  strings in the file, always).
- Verify: catalog lookup unit tests (known → control kind, unknown → raw).

### W23-T2 — Editor upgrade
- `ClaudeCodeSection` env area, rebuilt on `useFileBackedEditor`: known flags render as
  labeled toggles/selects/number inputs with descriptions; unknown keys keep the raw
  KEY/value rows (add/remove) — full capability preserved.
- **Secret masking**: any value whose key matches the credential shapes (`*_API_KEY`,
  `*_SECRET`, `*TOKEN*`) renders masked with explicit reveal; values never logged (error
  `message` only — the existing slice rule, restated as a review gate).
- Save builds one env patch (catalog + raw rows merged) — one write, not per-flag writes.
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Known flags render typed controls with descriptions; unknown keys render raw rows;
      both round-trip through one save (test).
- [ ] Values persist as plain strings in `settings.json.env`; unrelated settings keys
      preserved at every level (Go test via `MutateSettingsJSON`).
- [ ] Credential-shaped values masked by default; reveal explicit; no value in any log
      (test + review gate).
- [ ] Toggling a flag off removes the key vs. setting a falsy value — semantics per
      catalog entry, asserted in tests (some flags are presence-based).
- [ ] Fresh `claude` session reflects a toggled flag (manual sanity: one observable flag,
      e.g. a verbosity/telemetry var).
- [ ] Writes dual-gated; section `electronOnly: true`.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — env flags change CLI behavior at launch; a wrong value type
  ("true" where the CLI expects "1") silently no-ops or errors at startup. The catalog
  encodes the value grammar per flag so the UI can't emit a shape the CLI rejects; unknown
  keys stay raw and unvalidated on purpose (the app must not guess).
- **Catalog rot** — CLI env vars change across versions; a stale catalog mislabels or
  misses flags. The fall-through-to-raw design means rot degrades to inconvenience, never
  to lost capability; catalog updates are one-line diffs.
- **Presence-vs-value semantics** — some flags act by mere presence. Getting
  remove-vs-set-empty wrong flips meaning; per-flag semantics live in the catalog and are
  test-asserted, not assumed.
