# Week 32 — Scheduled Auto-Cleanup, Drift Alerts + Program QA

**Objective:** Close the program: optional scheduled execution of the week-31 policy,
watcher-driven drift alerts when the CLI (or anything else) rewrites config underneath the
app, and an end-to-end QA pass over the whole 32-week surface.

**Prerequisites:** week 31 (policy engine), week 15 (`config-file-change` watcher events on
`settings.json` / `~/.claude.json`), week 14 (health panel hosts the status), week 13
(notification pipeline for alerts).

## Tickets

### W32-T1 — Scheduled auto-cleanup (opt-in, consent-preserving)
- Scheduler in the Go backend (ticker while the app runs — no OS-level daemon/launchd
  registration; the app only cleans while it is open, stated plainly): interval setting
  (off by default / weekly / monthly) in the week-31 policy document.
- **Consent model**: a scheduled run executes ONLY categories the user marked
  "auto-approved" in the policy panel (a second, explicit per-category flag beyond
  "enabled"); everything else lands as a PENDING report — a notification (week-13 pipeline)
  linking to the combined dry-run for one-click human confirm. Auto-approved runs still
  produce receipts (trash), never plain deletes, and never include the plain-delete
  categories (9, 12–13) which remain manual-only.
- Missed schedule (app closed) → run-on-next-launch with the same consent rules.
- Verify: fixture schedule fires; non-auto-approved categories produce pending reports,
  not deletions; receipts exist for auto-approved ones.

### W32-T2 — Config drift alerts
- Consume week-15 `config-file-change` events: when `settings.json` or `~/.claude.json`
  changes outside the app's own writers (the mute-window signal distinguishes app writes),
  raise a low-priority notification with a deep-link to the week-15/20 diff views —
  "settings.json changed externally: 3 keys" — so hand-edits and CLI rewrites stop being
  invisible.
- Debounced + deduplicated (the CLI rewrites `~/.claude.json` constantly: batch to at most
  one alert per file per hour, and `~/.claude.json` alerts default OFF — settings.json ON).
- Verify: external edit fixture raises one alert with a working diff link; app-initiated
  writes raise none.

### W32-T3 — Program QA pass
- End-to-end sweep of the whole program against its invariants, as executable checks where
  possible:
  - Grep gate: no `os.RemoveAll`/`os.Remove` on user data outside `internal/maintenance`
    (`TrashItems`/`EmptyTrash` are the only deleters); no `settings.json` write outside
    `MutateSettingsJSON`; no hardcoded `os.UserHomeDir()/.claude` outside the week-1
    resolver.
  - UI gate audit: every mutating surface carries the dual gate (`electronOnly` +
    `connectionMode === 'local'`) — checklist against weeks 2–13, 15–17, 19, 21, 23–29, 31.
  - Masking audit: secret-masking present on every value-rendering surface (18, 20, 22, 23).
  - Full-cycle scenario on a fixture `~/.claude`: scan → clean → restore → settings edit →
    external-drift alert → export → import (hooks land disabled) → purge stale claude.json
    entries → `claude --version` still healthy.
- Verify: the grep gates run in CI (`go vet` step or a small script) so the invariants
  outlive the program.

## Exit criteria

- [ ] Scheduler off by default; scheduled run deletes ONLY auto-approved categories, via
      trash, with receipts; the rest becomes a pending-report notification (tests).
- [ ] Missed-schedule catch-up honors the same consent rules (test).
- [ ] External settings.json edit → one drift alert with diff deep-link; app's own writes
      → none; `~/.claude.json` alerts default off (tests).
- [ ] All three grep gates pass on the codebase and run in CI (script committed).
- [ ] Dual-gate + masking audits pass across the listed weeks (checklist in PR).
- [ ] Full-cycle fixture scenario passes, ending with a healthy CLI launch.
- [ ] `go test ./...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself — now unattended.** Scheduling moves destructive execution out
  from under the user's eyes; every prior safeguard assumed a human at the confirm dialog.
  The auto-approve-per-category consent flag, trash-only rule, plain-delete exclusion, and
  pending-report default are what make "scheduled" defensible at all; loosening any of them
  is a redesign, not a tweak.
- **Alert fatigue** — the CLI's constant `~/.claude.json` rewrites could bury real drift
  signals in noise, training users to dismiss the very alert that matters. Per-file
  defaults (noisy file off), hourly batching, and low-priority severity are the tuning;
  measured by whether the settings.json alert stays rare enough to read.
- **Invariant decay after the program ends** — the guarantees built over 32 weeks erode
  with the first post-program refactor unless enforced mechanically. The CI grep gates are
  this week's most durable deliverable.
