# Week 21 — ~/.claude.json Guarded Purge-Write

**Objective:** The write half of week 20: remove provably-stale project entries from
`~/.claude.json` with the tightest guardrails in the program. HIGH CARE — this file is
CLI-critical, holds auth material, and the CLI rewrites it constantly during live sessions.

**Prerequisites:** week 20 (inspector, stale/unverifiable triage, backups integration),
week 15 (settings_write pattern mechanics). This is an **in-file edit** week: the file is
NEVER handed to `TrashItems` (edit-only by name, per the program deletion policy).

## Tickets

### W21-T1 — Guarded mutator
- New `internal/files` mutator for `~/.claude.json` following the settings_write pattern's
  mechanics — read-fresh-at-write-time, corrupt → error-and-don't-touch, own backup,
  temp+rename — with its OWN dedicated mutex (never `settingsWriteMu`; different file,
  per-file locking rule).
- **Typed minimal diff only**: the mutate callback may remove entries from the project map
  and nothing else. Auth/credential keys (OAuth account, tokens, anything
  credential-shaped) are on an explicit deny-list the mutator enforces structurally — a
  callback attempting to touch them errors before any disk I/O.
- Pre-write backup goes to the app's own receipt (so restore is one click in the trash UI)
  AND respects the CLI's `backups/` mechanism by never writing into that dir — the app
  keeps its backups in appdata, the CLI keeps its own.
- Concurrent-rewrite defense: after temp+rename, re-read and verify the purged entries are
  absent; if the CLI's own rewrite raced us and resurrected state, report it (no silent
  retry loop — one retry, then surface).
- Verify: `go test ./internal/files/...` — purge removes exactly the chosen entries;
  every other key byte-preserved; deny-list blocks a hostile callback; corrupt file
  untouched; race fixture surfaces the conflict.

### W21-T2 — Purge UI
- Week 20's inspector gains the write affordance: stale entries (ONLY the provably-dead
  triage class — never "unverifiable") get checkboxes → dry-run preview listing the exact
  entry keys and their sizes → typed confirm ("purge N project entries") → mutator.
- Post-purge report: bytes saved (live re-read), app-side backup receipt link, and a "CLI
  still healthy" nudge to run `claude --version`.
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Purge removes exactly the selected provably-stale entries; all other 90+ keys
      byte-preserved at every nesting level (test).
- [ ] Auth deny-list enforced structurally: a mutate callback touching credential keys
      errors with zero disk writes (test).
- [ ] Dedicated mutex used; `settingsWriteMu` untouched by this path (review gate).
- [ ] Unverifiable entries cannot be selected for purge (UI + service-level rejection,
      test).
- [ ] App-side backup created per purge; one-click restore returns the file to its
      pre-purge state (test).
- [ ] Race fixture (CLI rewrite between read and rename) surfaces a conflict, never a
      silent half-purge (test).
- [ ] Fresh `claude` session after purge: starts clean, auth intact, remaining projects
      listed (manual sanity — the QA bar for this week).
- [ ] Writes dual-gated; `go test ./internal/files/...`, `bunx tsc --noEmit`,
      `bun run test` green.

## Risks

- **Breaks the CLI itself — the program's sharpest write.** A malformed `~/.claude.json`
  can block CLI launch outright, and stripping auth keys logs the user out of `claude`
  everywhere. Structural deny-list, minimal-diff mutator, atomic write, app-side backup,
  and the CLI's own `backups/` as a second recovery layer: five independent nets, all
  mandatory.
- **The CLI writes this file WHILE we do** — the concurrent-write window is minutes-wide in
  live sessions, far wider than settings.json. Read-fresh + post-write verify + surface-on-
  conflict chooses correctness over convenience; this week ships slower UX rather than a
  lost-update.
- **False-stale purge** — deleting a project entry the user still needs costs re-onboarding
  state (trust prompts, per-project flags). Only the provably-dead class is purgeable, and
  the week-20 triage that feeds it errs toward "unverifiable" by design.
