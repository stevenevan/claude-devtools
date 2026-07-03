# Week 28 — Memory Manager

**Objective:** Tend the persistent-memory surfaces: per-project `memory/` dirs (MEMORY.md
index + fact files with frontmatter and `[[wiki-links]]`) and `agent-memory/` (audit: one
agent's files populated, several dirs empty). Integrity checking — dangling links, orphan
files, index/file drift — plus editing and cleanup.

**Prerequisites:** weeks 15, 25 (editor kit + text write path — memory dirs join the
allowlist), week 2 (`TrashItems` for deletions), week 8 (empty-dir sweep covers
`agent-memory/` shells).

## Tickets

### W28-T1 — Memory integrity model
- Parser for a memory dir: MEMORY.md index entries (markdown links), fact files
  (frontmatter `name/description/type` + body), `[[name]]` link extraction.
- Integrity findings, each with a proposed fix:
  - **Orphan file** — exists on disk, absent from MEMORY.md → propose index line.
  - **Dangling index entry** — MEMORY.md links a missing file → propose removal.
  - **Dangling `[[link]]`** — informational only (the memory convention allows
    forward-links to not-yet-written memories; NOT an error — flag, never auto-fix).
  - **Duplicate `name:` slugs** across files → list for manual merge.
- Verify: fixture memory dir exercising all four finding kinds.

### W28-T2 — Manager UI
- Panel: memory-dir picker (per-project + agent-memory), file list with type badges,
  integrity findings list with one-click accepted fixes (index-line add/remove ONLY —
  content is never auto-edited), fact-file editor via the week-25 path (byte-faithful,
  `.bak`), delete via `TrashItems`.
- Index fixes write MEMORY.md through the week-25 writer; every accepted fix is one
  undoable write.
- `agent-memory/` empty dirs deep-link to the week-8 sweep rather than duplicating it.
- Dual gate: writes `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] All four integrity finding kinds detected on the fixture; dangling `[[links]]`
      informational, never auto-fixed (tests).
- [ ] Accepted orphan fix adds exactly one index line; accepted dangling-entry fix removes
      exactly one; MEMORY.md otherwise byte-identical (tests).
- [ ] Fact-file edit round-trips byte-faithfully outside the edited range; frontmatter
      re-parses (tests).
- [ ] Deleting a memory file lands in trash; the finding list immediately shows the new
      dangling index entry (live re-scan).
- [ ] Writes dual-gated; panel hidden in browser build.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — MEMORY.md is loaded into agent context each session; a
  corrupted index degrades every future session's recall quietly. One-finding-one-write,
  `.bak`, and byte-identity outside the fix keep index surgery minimal and reversible.
- **Over-eager hygiene** — "dangling" `[[links]]` are a FEATURE of the memory convention
  (markers for memories worth writing); auto-fixing them destroys intent. The
  informational-only rule is a product decision encoded as a review gate.
- **Cross-dir confusion** — per-project memory dirs are namespaced by encoded project path;
  writing a fix into the wrong project's MEMORY.md corrupts two projects at once. The
  dir picker pins every write to one explicit root, and the writer's allowlist check
  (week 25) enforces it.
