# Week 27 — Skills Manager

**Objective:** Browse, inspect, and safely remove skills in `~/.claude/skills/` (audit: ~23
dirs INCLUDING SYMLINKS — several resolve outside `~/.claude` to real repos). The symlink
population makes this the week where the week-2 link-vs-target distinction earns its keep:
"remove symlink" and "delete skill contents" are different operations and the UI must never
blur them.

**Prerequisites:** weeks 1–2 (symlink-flagged scan, symlink-safe `TrashItems`), week 25
(text editor for SKILL.md). Existing readers:
- `internal/files/pathutil.go:389-419` — `ReadGlobalSkills` (follows symlinks via
  `EvalSymlinks` for READING — correct for reads, forbidden for deletes)
- The existing `skills` ActivityView (read-only browser this week upgrades)

## Tickets

### W27-T1 — Skills inventory model
- Per-skill entry combining the existing reader with week-1 scan data: name, SKILL.md
  description, dir size, references/ presence, and the load-bearing flag —
  `IsSymlink` + resolved target path when linked.
- Symlinked skills display: "symlink → `<target>` (outside ~/.claude)" with the explicit
  note that removing the link does NOT delete the target and does NOT reclaim the target's
  space.
- Verify: fixture skills tree (real dir, in-root symlink, out-of-root symlink) inventories
  with correct flags.

### W27-T2 — Manager UI
- Upgrade the existing skills view: list (name, description, size, symlink badge) → detail:
  SKILL.md rendered (existing markdown pipeline), references/ file list, and actions:
  - **Edit SKILL.md** — week-25 editor path (real dirs only; editing THROUGH a symlink
    writes the outside target — disabled for linked skills with the reason shown).
  - **Remove symlink** — trashes the LINK entry only (week-2 invariant 2).
  - **Delete skill** — real dirs only: whole-dir `TrashItems` with dry-run preview.
- No enable/disable state exists for skills in the CLI's model (presence == enabled);
  the panel says so instead of inventing a toggle that would really be a move/delete.
- Dual gate: all mutations `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Inventory distinguishes real/in-root-link/out-of-root-link per fixture matrix; badges
      and target paths correct.
- [ ] Removing an out-of-root symlink trashes only the link; target dir untouched (test —
      the program's canonical symlink assertion, on real feature ground).
- [ ] Restore of a trashed link recreates the symlink pointing at the same target (test).
- [ ] Deleting a real skill dir round-trips through trash; references/ contents restored
      byte-identical (test).
- [ ] Edit disabled for symlinked skills with the reason displayed (review gate).
- [ ] Fresh Claude Code session no longer offers a removed skill (manual sanity).
- [ ] Mutations dual-gated; `go test ./internal/...`, `bunx tsc --noEmit`,
      `bun run test` green.

## Risks

- **Deleting through a link** — the historic failure mode this program was designed
  against: resolve-then-delete destroys a real repo outside `~/.claude`. Week 2's
  Lstat/link-entry invariant plus this week's edit-disable-for-links closes both the delete
  and the sneaky write path (editing through a link).
- **Breaks the CLI itself** — removing a skill another surface references (a slash command
  or plugin flow invoking it by name) degrades those flows at runtime. Trash-not-delete
  keeps it one-click reversible; the panel shows the skill name prominently so removal is
  informed.
- **Read/delete asymmetry confusion** — the reader legitimately follows links
  (`EvalSymlinks` at `pathutil.go:389-419`), deletes must not; a maintainer "unifying" the
  two behaviors would reintroduce the escape. The asymmetry is documented in code comments
  at both sites.
