# Week 10 — history.jsonl Retention

**Objective:** Age-out for `history.jsonl` (audit: 4.8 MB, ~11,500 lines spanning 9 months)
— the CLI's prompt-history file that grows forever. User data (typed prompts), so this is a
**trash-policy** week: the pruned tail is preserved as a restorable receipt.

**Prerequisites:** weeks 1–2 (`ScanCategory`, `TrashItems`). Cross-reference: week 30's
permission analyzer mines this file — pruning here removes its input; the trashed tail must
remain analyzable (see W10-T3).

## Tickets

### W10-T1 — History analysis
- Parser (streaming, line-by-line — `bufio.Scanner` with a large buffer, same pattern as
  `internal/parsing`) that reports: total lines, byte size, date range, and a per-month
  histogram from each entry's timestamp. Malformed lines counted, never fatal.
- `CategorySpec`: entries older than a cutoff (default 180 days), reported as line-count +
  approximate bytes.
- Verify: fixture history with mixed dates + one corrupt line yields correct buckets and a
  nonfatal malformed count.

### W10-T2 — Age-out with tail preservation
- Rewrite flow (this is an in-file prune of a CLI-owned file — the settings_write pattern's
  mechanics apply): read fresh, split at the cutoff, write the pruned tail (old entries) to
  a file that is handed to `TrashItems` as the receipt payload, then atomically replace
  `history.jsonl` with the retained head via temp+rename. Never edit in place.
- If `history.jsonl` gained lines between read and write (CLI appended mid-prune), abort and
  retry once; on second conflict, surface the error — never drop a freshly-typed entry.
- Restore = the receipt file's entries can be prepended back (documented manual/assisted
  path in the trash UI; exact-byte restore of a since-appended file is impossible and the
  UI says so).
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: prune fixture → head retained byte-exact, tail in trash, line counts sum to
  original.

### W10-T3 — Week-30 cross-reference
- The receipt's tail file keeps the JSONL format intact so the future permission analyzer
  (week 30) can mine trashed history as well as live history. State this in the trash UI
  entry ("preserved in analyzable form").
- Verify: tail file parses with the same streaming parser.

## Exit criteria

- [ ] Histogram + cutoff candidates derived from live parse (no frozen line counts).
- [ ] Prune retains all entries newer than cutoff byte-exact; tail lands in trash as valid
      JSONL; `retained + trashed == original` line count (test).
- [ ] Concurrent-append conflict detected and retried/aborted without losing the appended
      line (test simulating an append between read and write).
- [ ] No leftover `.tmp` after success or after an injected failure (test).
- [ ] Prune action dual-gated; hidden in browser build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — `history.jsonl` backs the CLI's prompt-history (up-arrow
  recall); a malformed rewrite (partial line, wrong encoding) can break history loading on
  next launch. Atomic temp+rename, read-fresh, and the append-conflict retry are mandatory,
  not defensive flourish.
- **Live-append races** — unlike settings.json, this file is appended on every user prompt;
  the race window is real. The abort-on-conflict rule chooses losing the PRUNE, never losing
  the user's data.
- **Analyzer starvation** — aggressive age-out leaves week 30 mining a stub. The analyzable
  trash tail plus the 180-day default keeps enough signal; the cross-reference is stated in
  both weeks.
