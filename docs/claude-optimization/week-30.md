# Week 30 — Permission Analyzer

**Objective:** Mine the user's own usage — `history.jsonl` and parsed session tool-call
records — to SUGGEST permission allowlist entries (e.g. a Bash command pattern approved
manually dozens of times), surfaced as display-only suggestions inside the week-19
permissions editor. The user's history is treated as UNTRUSTED DATA throughout: it can
contain attacker-shaped strings (pasted web content, hostile repo file names) that must
never steer a suggestion.

**Prerequisites:** week 19 (permissions editor + its empty suggestions drawer and write
paths), week 10 (history retention — its trashed tail stays analyzable; this analyzer reads
live + trashed history), existing session parsing (`internal/parsing`,
`internal/analysis` tool-execution records).

## Tickets

### W30-T1 — Structured mining
- Input is ONLY structured records: tool-invocation entries from parsed session data
  (tool name + structured arguments) and history entries' structured fields. **No free-text
  scraping** — a regex over raw conversation text could ingest injected strings crafted to
  look like commands; conversation content is never interpreted as instructions or parsed
  into suggestions.
- Aggregation: identical/prefix-groupable invocations counted across sessions; a suggestion
  candidate requires a minimum recurrence (default: seen ≥5 times across ≥3 sessions).
- **Narrowest-match rule**: emit the tightest pattern covering the observed calls — exact
  command for singletons-with-recurrence, single-level prefix (`Bash(git status:*)`) only
  when the observed set actually varies. Hard-forbidden output shapes: `Bash(*)`,
  bare-tool wildcards, any rule broader than the observed evidence. The forbidden list is
  enforced in code, not convention.
- Verify: `go test` — fixture records yield narrow rules; adversarial fixture (hostile
  strings in free-text fields) yields ZERO suggestions from those fields; forbidden shapes
  unrepresentable.

### W30-T2 — Suggestions surface
- Fill week-19's drawer: suggestion rows (proposed rule, evidence count, sample
  invocations on expand). Actions: per-rule **Add to allow** (writes through week-19's
  existing paths, one rule per explicit click) or dismiss. No bulk-apply, no auto-apply,
  ever.
- All processing local (Go side); history/session content never leaves the machine and
  never lands in logs.
- Dual gate on apply (it's a week-19 write): `electronOnly: true` AND
  `connectionMode === 'local'`. Suggestion display itself is read-only.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Suggestions derive only from structured invocation records; adversarial free-text
      fixture produces zero suggestions (test — the week's defining assertion).
- [ ] Every emitted rule is the narrowest match for its evidence; forbidden broad shapes
      cannot be constructed (tests).
- [ ] Recurrence thresholds honored; below-threshold patterns absent (test).
- [ ] Apply writes exactly one rule via week-19's path per click; no bulk path exists
      (review gate + test).
- [ ] Dismissed suggestions stay dismissed across restarts (persisted in
      `claude-devtools-config.json`).
- [ ] Apply dual-gated; `go test ./internal/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself — via its safety rails** — the failure mode isn't a crash but a
  quietly over-broad allowlist that disarms the permission system on every future session.
  Narrowest-match + forbidden shapes + per-rule explicit apply keep every widening a
  deliberate human act.
- **Prompt-injection-shaped history** — an attacker who lands a crafted string in the
  user's history (web paste, malicious repo) must not be able to steer a suggestion. The
  structured-records-only rule is the defense in depth; the adversarial fixture keeps it
  honest forever.
- **Analyzer trust laundering** — "the app suggested it" reads as an endorsement. Evidence
  counts + sample invocations per suggestion make the user the informed judge, and the
  drawer copy says suggestions are derived from their own usage, not vetted for safety.
