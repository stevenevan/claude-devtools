# Week 20 — ~/.claude.json Inspector (Read-Only)

**Objective:** X-ray the CLI's most critical state file: `~/.claude.json` (audit: 165 KB,
90+ top-level keys, 56 project entries vs ~22 live project dirs). Read-only this week:
stale-entry detection, key census, and diff against the CLI's OWN backup mechanism
(`backups/*.claude.json.backup.*` — 5 auto-generated snapshots at audit). The guarded write
is week 21.

**Prerequisites:** week 15 (`<JsonDiffView>`, watcher extension covers `~/.claude.json`),
week 18 (masking conventions). Existing code:
- `internal/discovery/project_scanner.go` — live project dirs (the stale-entry
  cross-reference)

## Tickets

### W20-T1 — claude.json reader + census
- `internal/files` reader for `~/.claude.json` (path via the week-1 effective-root
  resolver's HOME conventions): top-level key census (name, value kind, approximate size),
  project-entry table, and one-off flag keys (`hasSeen*`, `cached*`) grouped.
- **Credential masking is non-negotiable**: OAuth account blobs, tokens, anything
  credential-shaped renders masked with explicit per-value reveal; values never logged.
- Stale-project detection: entries whose path no longer exists on disk, cross-checked
  against live `discovery` scan. Hyphen-ambiguous paths (the decoder trap) marked
  "unverifiable" rather than stale — never guess a deletion candidate.
- Verify: fixture claude.json + fixture project dirs yield correct stale/live/unverifiable
  triage and masking.

### W20-T2 — Backups integration
- Enumerate `backups/*.claude.json.backup.*` (the CLI's own rolling backups — the app must
  understand this mechanism before week 21 adds writes, not duplicate it); list with
  timestamps + sizes; `<JsonDiffView>` between the live file and any backup, or between two
  backups.
- Verify: fixture backups enumerate and diff correctly.

### W20-T3 — Inspector panel
- Read-only panel: key census, project-entry table with stale badges, flags group, backups
  list + diff. Live-refresh on the week-15 `config-file-change` event (the CLI rewrites
  this file constantly — a stale inspector misleads).
- Read-only week: renders in browser mode; ZERO write actions; the "purge stale entries"
  button appears in week 21, not here.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Census, project table, and flag groups render from the live file; stale/unverifiable
      triage matches the fixture matrix (counts from live cross-reference, never the
      audit's 56-vs-22 snapshot).
- [ ] Credential-shaped values masked by default; reveal explicit; nothing logged (review
      gate + test).
- [ ] Backups enumerated; live-vs-backup diff renders key-level changes.
- [ ] External CLI write to `~/.claude.json` refreshes the inspector via
      `config-file-change` (test).
- [ ] Panel exposes zero write/delete actions (review gate); read-only in browser mode.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Stale-detection false positives** — the path-decoding ambiguity that fooled the initial
  audit (hyphenated repo names) will fool this detector too; a false "stale" label here
  becomes a wrong DELETE in week 21. The unverifiable third state exists precisely so
  week 21 only ever offers provably-dead entries.
- **Reading a file mid-rewrite** — the CLI rewrites `~/.claude.json` frequently; a read
  during its temp+rename could see a vanishing file. Read-with-retry on ENOENT, and treat
  parse failure as "try again", never as "file is corrupt, offer repair".
- **Secret exposure** — this file holds real account/token material; the masking rules are
  the same contract as week 18 and reviewed with the same severity.
