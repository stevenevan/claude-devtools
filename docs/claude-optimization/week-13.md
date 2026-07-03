# Week 13 — Notifications Data Management

**Objective:** Stop `claude-devtools-notifications.json` from accumulating forever (audit:
21 entries and growing). Add clear-all and auto-prune to the app's OWN notification store —
the easiest write of the program (app-owned file, atomic writer already exists). Plain-delete
policy: app-owned, regenerable-by-usage data, no trash.

**Prerequisites:** week 1 (maintenance view). Existing code — this is mostly wiring:
- `internal/notifications/manager.go:38,96-102` — the store + its atomic tmp→rename writer
- `internal/notifyservice` — `NotificationsClear`, `NotificationsDelete` etc. already bound
- `frontend/src/renderer/components/notifications/` — existing panel UI

## Tickets

### W13-T1 — Auto-prune policy in the notifications manager
- Extend `internal/notifications/manager.go`: on load and on append, drop entries older
  than a configurable retention (default 30 days) and cap total count (default 200,
  oldest-out). Uses the existing atomic writer — no new persistence code.
- Policy values live in `claude-devtools-config.json` via `internal/config` (existing
  manager), editable from the notifications settings section.
- Read notifications are pruned first when the cap bites; unread survive to the cap.
- Verify: `go test ./internal/notifications/...` — fixtures crossing age and count limits
  prune correctly, unread-last ordering respected.

### W13-T2 — UI wiring
- Notifications panel (`components/notifications/`): the existing clear-all action gets a
  confirm dialog stating the plain-delete semantics ("removed immediately — notifications
  are not moved to trash"); settings section
  (`components/settings/sections/NotificationsSection.tsx`) gains the two policy controls
  (retention days, max count).
- Maintenance view cross-link: the notifications store shows up in the week-1 scan table;
  its row deep-links to the notifications panel.
- Gate: mutating actions `electronOnly: true` AND `connectionMode === 'local'` (the store
  file lives in the local `~/.claude`).
- Verify: `bunx tsc --noEmit` + `bun run test` green (notificationSlice tests extended).

## Exit criteria

- [ ] Auto-prune enforces age + count limits on load and append (tests, fixture-driven —
      limits asserted against live store contents, not frozen entry counts).
- [ ] Clear-all empties the store via the existing atomic writer; file remains valid JSON;
      nothing appears in `ListTrash` (plain-delete policy assertion).
- [ ] Policy values persist in `claude-devtools-config.json`, survive restart, and take
      effect without app restart.
- [ ] Unread notifications outlive read ones under count pressure (test).
- [ ] Mutating actions dual-gated; controls hidden in browser build.
- [ ] `go test ./internal/notifications/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — near-zero here (the CLI never reads this app-owned file), but
  the write path shares the `~/.claude` directory: a bug that wrote the wrong PATH could
  clobber a CLI file. The manager's existing hardcoded filename + atomic writer is the
  containment; no new path construction is permitted in this week's diff.
- **Silent data loss on policy change** — setting retention to 1 day instantly destroys
  history the user may want. The confirm dialog on clear-all plus showing "N entries will be
  pruned" when tightening policy keeps it intentional.
- **Dual-writer race** — the notification detector appends while the user clears. The
  manager's single-writer design (all mutations through `internal/notifications`) already
  serializes this; keep every new mutation inside the manager, never a second writer.
