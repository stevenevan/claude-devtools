# Week 8 — Junk Sweep

**Objective:** One-click sweep for zero-value clutter: scattered `.DS_Store` files (audit:
52 KB+ across agents/, skills/, plans/, telemetry/, plugins/), empty directories
(`debug/`, `ide/`, `downloads/`, `.cc-writes/`, empty `agent-memory/*` subdirs), and
leftover `*.tmp` files from interrupted atomic writes.

**Prerequisites:** weeks 1–2 (`ScanCategory`, `TrashItems`, dry-run dialog).

## Tickets

### W8-T1 — Junk category specs
- Three `CategorySpec` matchers, each independently toggleable:
  1. **macOS cruft:** `.DS_Store` anywhere under the effective root (Lstat, no symlink
     traversal — week-1 scan semantics).
  2. **Empty dirs:** directories containing nothing (or only `.DS_Store`) — recomputed live;
     the audit's list (`debug/ ide/ downloads/ .cc-writes/`) is illustrative, the matcher
     decides. Protected set: never offer top-level dirs the CLI recreates and expects
     (`projects/`, `todos/` if present, `plugins/`) even when empty — deleting them buys
     nothing and risks a CLI mkdir race.
  3. **Stale temp files:** `*.tmp` older than 1 day (orphans of temp+rename writes —
     including, one day, this app's own).
- Verify: fixture tree — nested `.DS_Store`, an empty dir chain, a fresh `.tmp` (excluded)
  and a stale `.tmp` (included) — all matched correctly.

### W8-T2 — Sweep panel
- Panel under `components/maintenance/`: three toggle groups with live candidate counts +
  bytes from `ScanCategory`; combined dry-run preview (every path listed) → confirm →
  `TrashItems`.
- `.DS_Store` and stale `.tmp` are trivially regenerable/worthless — still routed through
  `TrashItems` (they live inside user dirs; the trash route costs nothing and keeps ONE
  delete path program-wide).
- Empty-dir removal happens deepest-first so parent dirs emptied by the sweep are caught in
  the same pass.
- Dual gate: `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] All three matchers produce live candidates on the fixture; counts/bytes come from
      `ScanCategory` output (no frozen audit numbers).
- [ ] Protected top-level dirs never listed even when empty (test).
- [ ] Fresh `.tmp` (< 1 day) excluded; stale included (test).
- [ ] Sweep produces one `TrashReceipt`; empty-dir chain removed deepest-first; restore
      recreates the dirs (test).
- [ ] Re-running the sweep immediately after reports zero candidates (idempotence, live).
- [ ] Dry-run preview mandatory; destructive action dual-gated; panel hidden in browser
      build.
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — an "empty" dir can be a structural marker the CLI recreates or
  relies on (lock dirs, watch roots). The protected set plus trash-not-delete keeps every
  removal reversible; when in doubt a dir stays listed but unchecked by default.
- **Temp-file races** — a `.tmp` younger than the threshold may be an atomic write IN
  PROGRESS (the CLI writes `settings.json.tmp` before renaming). The 1-day age floor is the
  guard; never sweep fresh temp files no matter how junk-shaped.
- **Matcher overreach** — "junk" matchers tempt regex creep (`*.log`? `*.bak`?). Scope
  fence: exactly the three matchers above; backups are week 7, logs are week 9.
