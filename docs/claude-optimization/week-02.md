# Week 2 — Safe-Delete Engine (Trash, Dry-Run, Restore)

**Objective:** Ship the program's single destructive primitive: a trash engine with
confinement, symlink-safe deletion, restore, and permanent-delete semantics. Every cleanup
week (3–8, 10–11, 29, 31) routes through it; none ships its own delete code.

**Prerequisites:** week 1 (`internal/maintenance`, root + appdata resolvers,
`maintenanceservice`, maintenance view). Existing code to reuse:
- `internal/files/pathutil.go:42` — `Confine()` (path containment; do NOT re-invent)
- `internal/discovery` — `IsValidSessionID` (pattern-validation precedent for receipt IDs)
- `internal/watcher/runner.go` — debounced watcher whose consumers must not storm-refresh
  during app-initiated bulk deletes

## Tickets

### W2-T1 — Trash primitives in `internal/maintenance`
- `TrashItems(paths []string) (TrashReceipt, error)`, `ListTrash() ([]TrashReceipt, error)`,
  `RestoreTrash(receiptID string) error`, `EmptyTrash(receiptIDs []string) error`.
- `type TrashReceipt struct { ID string; TrashedAt time.Time; Items []TrashedItem }`;
  `type TrashedItem struct { OrigPath string; RelStore string; Bytes int64 }`.
- Trash root `<appdata>/trash/<receiptID>/`, created `0700` (contents inherit conversation
  logs and config sensitivity — do NOT copy the `0755` mkdir from
  `internal/files/settings_write.go`). Items stored under their source-relative path
  (`RelStore`) + a JSON manifest per receipt, so same-basename files from different dirs
  never collide.

### W2-T2 — Safety invariants (the heart of the program)
1. **Confinement, fail-closed:** every input path canonicalized and confined to the
   allowlist roots (effective `~/.claude` root + appdata) via the existing `Confine()`.
   Any out-of-root path → hard error, the WHOLE batch aborts, nothing moves.
2. **Symlink-safe:** containment-check the PARENT dir (`EvalSymlinks(filepath.Dir(path))`
   within root), `os.Lstat` the leaf, move the LINK entry itself — never resolve-and-move
   the target. A skill symlink pointing at a real repo outside `~/.claude` must never cause
   that repo to move. Do not weaken confinement to "make symlinks work" — the link's parent
   is inside the root; that is what gets checked.
3. **Restore:** `receiptID` validated against a strict UUID pattern (mirror
   `discovery.IsValidSessionID`) before touching the trash tree — no `../` traversal.
   Destination (`OrigPath`) re-confined at restore time (a hand-edited manifest must not
   redirect a restore to `/etc`). Never silently overwrite: if a file now exists at
   `OrigPath` (the CLI recreated it), fail with the conflict surfaced.
4. **Cross-volume:** `os.Rename` with copy+delete fallback on `EXDEV` (configured roots can
   live on another volume).
5. **Permanent delete:** `EmptyTrash` actually frees bytes (`os.RemoveAll` on receipts).
   Trash auto-expiry after N days is a week-31 retention category — record `TrashedAt` now.

### W2-T3 — Watcher mute window
- `TrashItems` exposes an expected-change signal so `watcher.Runner` consumers suppress
  auto-refresh storms while the app itself bulk-moves hundreds of files under the watched
  `projects/` tree. Service-level: `maintenanceservice` signals before/after a batch;
  the frontend `file-change` handler honors the mute window.
- Verify: trashing 200 fixture files under a watched dir produces no session-list refresh
  flicker (manual sanity) and no debouncer overflow (log assertion).

### W2-T4 — Service + UI
- `MaintenanceService` wrappers for all four commands; regenerate bindings + hand-maintained
  API files.
- Trash UI in `components/maintenance/`: receipt list (date, items, bytes), per-receipt
  Restore / Delete permanently, and the dry-run confirm dialog every consumer week reuses —
  exact resolved paths + total bytes + file count, from `ScanCategory` output.
- Honest labeling: the action verb is **"Move to trash"** (with the trash location shown),
  never "delete"; a separate explicit **"Delete permanently (skip trash)"** path exists for
  sensitive data. Trashing is not erasure and the UI must not imply it.
- Dual gate: all four actions `electronOnly: true` AND `connectionMode === 'local'`
  (`connectionSlice.ts`), with the local-only notice.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] `TrashItems(["/etc/hosts"])` returns an error and touches nothing (test).
- [ ] Trashing a symlink whose target lives outside `~/.claude` removes only the link; the
      target is intact (test).
- [ ] `RestoreTrash("../../etc")` rejected by pattern validation (test); restore onto an
      existing file fails with a conflict error, no overwrite (test).
- [ ] EXDEV path exercised: trash across a bind-mount/tmpfs fixture falls back to
      copy+delete (test, `//go:build linux` skip acceptable on CI if needed — document).
- [ ] Trash tree created `0700`; manifest present per receipt; restore round-trip returns a
      file to its exact `OrigPath` (test).
- [ ] `EmptyTrash` frees the bytes reported by `ListTrash` (live check via `ScanClaudeDir`
      output before/after — no frozen numbers).
- [ ] Bulk trash under `projects/` triggers no watcher-driven UI refresh during the mute
      window.
- [ ] Write/delete actions dual-gated (`electronOnly` + `connectionMode === 'local'`).
- [ ] `go test ./internal/maintenance/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **This primitive IS the blast radius** — every later cleanup week inherits exactly the
  safety this week builds. A confinement or symlink bug here becomes a data-loss bug in ten
  features. The five invariants above are non-negotiable review gates.
- **Breaks the CLI itself** — trashing a live CLI file (e.g. a session JSONL mid-write, or a
  path the CLI expects) can corrupt in-flight sessions. The mute window plus fail-closed
  confinement bounds this; consumer weeks must additionally avoid same-day/live files.
- **Retention honesty** — session JSONL and history hold conversation content (possibly
  secrets). "Deleted" data sitting in trash indefinitely betrays user intent; `EmptyTrash` +
  week-31 auto-expiry + honest labels are the mitigation, defined here once.
- **Trash growth irony** — a space-reclaim tool whose trash grows unbounded. `ListTrash`
  surfaces size; week 31 caps it; week 1's scan already includes appdata so it stays visible.
