# UX-08 — Skills

Rail visibility: **behind-More** ("What Claude can do") · Depends on: 01 · See
[README.md](README.md)

## 1. Goal

Explain what a skill is before listing them, and make the destructive actions on this page
unmistakable.

## 2. Establishes the pattern for sprints 09, 10 and 13

Skills, Agents, Plugins and Marketplace are all "installable thing with a name, a description, an
on/off state and a source". This sprint sets the card shape, the empty state, the enable/disable
affordance and the delete confirmation that those three then reuse. Deviating later needs a reason
recorded in that sprint's file.

## 3. Today

Root is `dashboard/SkillsManager.tsx` (221 lines) with `dashboard/SkillDetail.tsx`. It loads
`SkillInventoryEntry[]` (`SkillsManager.tsx:12, 18`), auto-selects the first skill
(`:50`), and holds two separate destructive confirmations — `pendingRemoveLink` and `pendingDelete`
(`:24-25`).

Problems for a non-technical reader:

- **The page assumes you know what a skill is.** There is no one-line explanation anywhere; the
  list starts immediately.
- **Two different destructive actions with near-identical framing.** "Remove link" and "delete" do
  materially different things — one unlinks, one destroys — and the difference is carried entirely
  by the verb.
- **Auto-selecting the first skill** means the page never shows a neutral state. A user landing here
  is immediately looking at one skill's detail without having chosen it.
- **Skill detail is frontmatter.** Name, description and tool permissions as the file declares
  them, which is a file format rendered as a UI.

## 4. Simple view

```
+--------------------------------------------------------------+
|  What Claude can do                                          |
|                                                              |
|  Skills are extra abilities you can give Claude — like        |
|  writing spreadsheets or reviewing code.                     |
|                                                              |
|  +--------------------------------------------------------+  |
|  |  Spreadsheets                                    [on]  |  |
|  |  Create and edit Excel files                           |  |
|  +--------------------------------------------------------+  |
|  |  Code review                                     [on]  |  |
|  |  Check code for problems before you ship it             |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  [ Find more skills ]                                        |
|                                                              |
|  No skills yet                                               |
|   Skills add abilities to Claude. Find some to get started.  |
+--------------------------------------------------------------+
```

Rules:

- **One sentence explaining skills, above the list.** Not a tooltip, not a help link.
- Each row: friendly name, one-line description, an on/off switch. Nothing else.
- **No delete in Simple mode.** Turning a skill off achieves what a non-technical user wants;
  deleting files does not. Delete stays in Nerd mode.
- No frontmatter, no tool permissions, no file paths.
- Nothing is selected on arrival. The list is the page; detail opens on click.
- Empty state explains and points somewhere.

## 5. Nerd view

Today's page, unchanged: the list, `SkillDetail` with frontmatter and tool permissions, both
destructive actions.

Additions: the two destructive actions are visually distinguished from each other, each naming its
consequence ("Unlink from source — the files stay" versus "Delete files — cannot be undone"), and
neither is the default focus of its dialog.

## 6. Words

| Today | Simple | Nerd |
|---|---|---|
| Skills | What Claude can do | Skills |
| Skill | Skill (explained in a sentence) | Skill |
| `allowed-tools` frontmatter | — (hidden) | `allowed-tools` |
| Remove link | — (not offered) | Unlink from source |
| Delete | — (not offered) | Delete files |
| Skill path | — (hidden) | absolute path |

## 7. Files touched

- `frontend/src/renderer/components/dashboard/SkillsManager.tsx`
- `frontend/src/renderer/components/dashboard/SkillDetail.tsx`
- `frontend/src/renderer/components/dashboard/InstallableList.tsx` **(new)** — the shared card/list
  shape sprints 09, 10 and 13 reuse

## 8. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. `InstallableList.tsx` — name, description, on/off, optional source line. Built to be reused; keep
   it a plain list component with no skill-specific logic.
2. Simple view: explanatory sentence, `InstallableList`, no auto-selection, no delete.
3. Branch `SkillsManager.tsx` on `useUIMode()`.
4. Nerd mode: distinguish the two destructive actions, each naming its consequence. Reuse
   `ConfirmDialog`.
5. Empty and error states, both modes.

## 9. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`

Simple mode: an explanatory sentence is present; each row has a working on/off switch; no delete
action exists; no file path or frontmatter appears; nothing is auto-selected.

Nerd mode: matches today; the unlink and delete dialogs state different consequences and neither
button is the default focus.

## 10. Accessibility

- The list is a real list; each on/off control is a labelled switch whose accessible name includes
  the skill name — not a bare "on".
- Destructive dialogs move focus to the dialog and return it on close; the destructive button is
  never the initially focused element.
- The explanatory sentence is part of the page's heading structure, not a floating paragraph.

## 11. Dependencies

Sprint 01.

## 12. Risks / open questions

- **"Friendly name" may not exist.** `SkillInventoryEntry` may carry only a directory name like
  `document-skills:xlsx`. If there is no display name, Simple mode shows the name it has, cleaned
  of separators — it does not invent one.
- Descriptions come from skill frontmatter written by third parties, so length and tone vary
  wildly. Truncate to one line with the full text on expand; do not rewrite an author's
  description.
- Whether a skill can actually be turned "off" needs confirming. If skills have no enabled state
  and the only actions are link/unlink/delete, the Simple switch is dishonest — in that case Simple
  mode shows a read-only list with "Find more skills", and this file records that.
