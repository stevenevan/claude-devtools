# Week 12 — Cache Surfacing

**Objective:** Surface and manage the small regenerable caches that today are invisible:
`cache/changelog.md` (audit: ~400 KB), `stats-cache.json`, `paste-cache/` (dozens of pasted
blobs), and `mcp-needs-auth-cache.json`. Regenerable by definition — this week uses the
**plain-delete policy** (confirm, no trash).

**Prerequisites:** week 1 (`ScanCategory`, maintenance view). NOT week 2 — caches are
explicitly outside the trash path per the program deletion policy.

## Tickets

### W12-T1 — Cache category spec
- `CategorySpec` enumerating the known cache surfaces with bytes + `ModTime` + a
  regenerated-by note (who rebuilds it: CLI update check rebuilds `cache/changelog.md`,
  usage tracking rebuilds `stats-cache.json`, next paste repopulates `paste-cache/`, next
  MCP probe rebuilds `mcp-needs-auth-cache.json`).
- `paste-cache/`: per-file candidates with age; pasted content can hold sensitive text, so
  the panel labels it "pasted content — may contain sensitive text" (motivates clearing,
  and explains why it's worth a look despite small size).
- Verify: fixture caches enumerate with correct notes and sizes.

### W12-T2 — Cache panel
- Panel under `components/maintenance/`: cache table (name, size, last refreshed,
  regenerated-by), per-entry **Clear** (plain delete with confirm — explicitly "deleted
  immediately, not moved to trash") and **Clear all caches**.
- `stats-cache.json` gets a **View** affordance (raw JSON viewer) — it holds
  dailyActivity/modelUsage data users may want to see before clearing; a richer dashboard
  is out of scope (YAGNI — the analytics view already exists for real analytics).
- Dual gate: clear actions `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Cache table shows live sizes/mtimes from `ScanCategory` (no frozen numbers).
- [ ] Clear is plain delete with confirm; nothing lands in `ListTrash` (explicit
      plain-delete policy assertion).
- [ ] Clearing every cache leaves the CLI functional: fresh `claude` invocation regenerates
      what it needs (manual sanity: `claude --version` + one session).
- [ ] `paste-cache/` sensitive-content label present; per-file selection works.
- [ ] Clear actions dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — a cache the CLI treats as required-at-startup (rather than
  rebuild-on-miss) would fail a launch after clearing. The known-surface allowlist (only the
  four named caches, never a `*cache*` glob) plus the post-clear CLI sanity check bound
  this; unknown cache-looking files are listed read-only, not clearable.
- **"Cache" misclassification** — the costliest failure here is calling something a cache
  that isn't (state, credentials). `mcp-needs-auth-cache.json` is genuinely a probe cache,
  but the panel's regenerated-by note forces each surface to justify its clearability
  explicitly; no note, no clear button.
- **Sensitive paste residue** — paste-cache blobs may hold secrets users pasted months ago;
  plain delete is actually the RIGHT call here (no trash copy extending retention), which is
  worth stating in the panel copy.
