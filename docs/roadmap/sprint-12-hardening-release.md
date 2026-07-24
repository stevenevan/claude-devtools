# Sprint 12 — Integration Hardening & Release

## 1. Goal
Cross-viewer QA, accessibility, a performance **regression** pass, docs, and release notes — turn
the eleven new surfaces into a shippable release.

## 2. Gap addressed
Not a data gap — the integration/hardening step for Sprints 01–11 (and 13 if built). It builds no
new viewer; it verifies the set holds together.

## 3. Scope (this sprint writes no new backend readers)
- **Cross-viewer QA:** each new view opens, empty-states cleanly (absent dir / empty file), and
  errors are surfaced not swallowed.
- **Accessibility:** keyboard navigation on the new lists (History, Transcripts, File-history,
  Marketplace, Usage, Task-graph) — reuse the existing shortcut infra
  (`hooks/useKeyboardShortcuts/`); focus order, ARIA on list rows, contrast against the theme
  tokens.
- **Performance REGRESSION pass (not new work):** confirm the virtualization/pagination *built in
  Sprints 01 and 02* still holds — 01's ~4 MB `history.jsonl` still paginates without freeze, 02's
  ~2200-file `transcripts/` list still scrolls smoothly — and spot-check the large reads in 03
  (file-history) and 06 (usage). The virtualization itself is owned by 01/02; this sprint only
  proves no regression after all sprints landed.
- **Docs:** update the `## Layout` and any relevant section of `CLAUDE.md` to name the new views,
  and refresh `docs/roadmap/README.md` with final status. Release notes.

## 4. Frontend / backend
No new commands or viewers. Only fixes surfaced by QA (empty states, a11y attributes, error
propagation) in the Sprint 01–11/13 components.

## 5. Tasks (ordered)
1. QA sweep across every new view (open, empty-state, error path) — file and fix defects in the
   owning component.
2. a11y pass (keyboard nav, focus, ARIA, contrast) on the new lists.
3. Performance regression checks against 01/02 acceptance criteria (+ 03/06 spot-checks).
4. Docs: `CLAUDE.md` layout section + `docs/roadmap/README.md` status + release notes.

## 6. Verification / acceptance
- `bun run qa` (typecheck + tests + Rust safety grep gate) green.
- `bun run test:rust` green.
- a11y checklist complete on each new list; large-dir scroll (transcripts ~2200, history ~4 MB)
  stays smooth — same thresholds Sprints 01/02 set.

## 7. Dependencies
All prior sprints (01–11, and 13 if built).

## 8. Drift / risk notes
- If a regression check fails, the fix belongs in the **owning** sprint's component, not a new
  abstraction here — keep this sprint about verification + wiring, not redesign.
