# Week 18 — Project-Level Settings Surfacing (Read-Only)

**Objective:** Surface the settings files users don't know they have: per-project
`.claude/settings.json` / `settings.local.json`, and oddities like the audit's nested
`~/.claude/.claude/settings.local.json` (a permission grant sitting where no one would ever
look). Read-only merged view — no writes this week.

**Prerequisites:** week 15 (`<JsonDiffView>` for source comparison). Existing readers:
- `internal/files/pathutil.go:150-172` — per-project `.claude/` discovery precedent
  (CLAUDE.md, rules)
- `internal/discovery/project_scanner.go` — known project roots

## Tickets

### W18-T1 — Settings-source discovery
- `internal/files` reader enumerating every settings source for a given project: global
  `settings.json`, global nested anomalies (a `.claude/` dir INSIDE `~/.claude` — flag as
  anomaly), project `.claude/settings.json`, project `.claude/settings.local.json`.
- Merged effective view: layered map (global → project → local) with per-key provenance
  (which file wins). Merge semantics documented as the app's best-effort model of CLI
  precedence, labeled as such — not asserted as CLI ground truth.
- **Secrets masked**: values under `env` and any credential-shaped key (`*_API_KEY`,
  `*_SECRET`, `*TOKEN*`, OAuth-shaped blobs) render masked by default with explicit
  per-value reveal. Raw values never logged.
- Verify: fixture project with all four sources yields correct provenance and masking.

### W18-T2 — Sources panel
- Read-only panel (settings surface or maintenance view): source list with existence badges
  and the anomaly flag, per-source raw view (masked), merged view with provenance chips,
  and `<JsonDiffView>` between any two sources.
- Read-only week: renders in browser mode; exposes ZERO write actions (editing moves rules
  in week 19).
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] All settings sources for a selected project enumerated with existence + anomaly flags
      (fixture test; nested `.claude/.claude` case covered).
- [ ] Merged view shows per-key provenance; diff view works between any two sources.
- [ ] Credential-shaped values masked by default; reveal is per-value and explicit; no
      value ever appears in logs (review gate + log assertion in tests).
- [ ] Panel exposes zero write/delete actions (review gate); renders read-only in browser
      mode.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Merge-model drift** — the CLI's real precedence rules may differ or change; presenting
  the merged view as authoritative would mislead. The "best-effort model" label and per-key
  provenance (always traceable to a real file) keep it honest.
- **Secret exposure by rendering** — an inspector that prints every settings value is a
  screenshot/shoulder-surf leak. Mask-by-default with explicit reveal is the contract, and
  the masking matcher errs broad (false-positive masking is a click; false-negative is a
  leak).
- **Read-only discipline** — provenance chips beg for "move this key" buttons; that write
  surface (with its own guardrails) is week 19. Any mutation in this diff is
  review-rejectable.
