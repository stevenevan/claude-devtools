# UX-10 — Plugins

Rail visibility: **behind-More** ("Add-ons") · Depends on: 01, 08 · See [README.md](README.md)

## 1. Goal

Make the plugin grid say what each plugin does and where it came from, instead of what version hash
it is pinned to.

## 2. Today

Root is `dashboard/PluginsGrid.tsx` (182 lines), rendered inside `GlobalContentView` with the title
"Plugins" (`layout/PaneContent.tsx:113-116`), which supplies the page's search field.

Each card shows: name, an Enabled/Disabled badge coloured emerald or zinc (`PluginsGrid.tsx:60-63`),
the marketplace it came from in 10px muted text (`:71`), and a version — where
`formatVersion` truncates a 12-plus-character hex string to seven characters (`:17-22`), i.e. a git
commit hash. Search filters on name and marketplace (`:145`).

Problems for a non-technical reader:

- **`v3f8a91c` is the most prominent metadata on the card.** It is a commit hash. It tells a
  non-technical user nothing and looks like it should mean something.
- **No description.** The card says what a plugin is called and where it came from, never what it
  does.
- **"Marketplace" is unexplained** and rendered at 10px, so the one piece of provenance information
  is also the least legible.
- **Enabled/Disabled is a coloured badge, not a control.** The state is shown; changing it is
  elsewhere.
- **The page inherits `GlobalContentView`'s search field**, which after sprint 01 sits below the
  shell's search field — two search boxes with different scopes, one above the other.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Add-ons                                                     |
|                                                              |
|  Add-ons bundle skills, helpers and commands together.       |
|                                                              |
|  +--------------------------------------------------------+  |
|  |  Codex                                          [on]   |  |
|  |  Hands work to OpenAI Codex when Claude is stuck        |  |
|  |  From: openai-codex                                    |  |
|  +--------------------------------------------------------+  |
|  |  Context7                                       [on]   |  |
|  |  Looks up current library documentation                |  |
|  |  From: context7                                        |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  [ Find more add-ons ]                                       |
+--------------------------------------------------------------+
```

Rules:

- Same list shape as [ux-08](ux-08-skills.md) — `InstallableList` with name, description, on/off,
  and a source line.
- **No version.** A commit hash is nerd-only, full stop.
- **"From: <marketplace>"** at readable size, because provenance is the one thing a cautious user
  should be able to see.
- The on/off badge becomes an actual switch if plugins can be toggled; if not, it stays a labelled
  state and the sprint records that.
- "Find more add-ons" links to Marketplace ([ux-13](ux-13-marketplace.md)).
- **One search field only** — the shell's. `GlobalContentView`'s is suppressed in Simple mode.

## 4. Nerd view

Today's grid, unchanged: the badge, the marketplace line, the truncated version. Additions: the
version gets a label so it reads as a version rather than as noise, and full-hash-on-hover.

Note that `GlobalContentView.tsx` is frozen by sprint 01 and shared with Annotations
([ux-11](ux-11-annotations.md)). UX-01 shipped without suppressing its page-local search in Simple
mode. The UX-07–10 grouped delivery owns the one-time frozen-file repair, as amended in
[README.md](README.md) §11, and verifies that no later page-local search is added.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Plugins | Add-ons | Plugins |
| Marketplace | From | Marketplace |
| `v3f8a91c` | — (hidden) | Version `3f8a91c` (full hash on hover) |
| Enabled / Disabled | on / off switch | Enabled / Disabled |
| (no description) | one-line description | one-line description |

## 6. Files touched

- `frontend/src/renderer/components/dashboard/PluginsGrid.tsx`
- `frontend/src/renderer/components/dashboard/InstallableList.tsx` — reused from
  [ux-08](ux-08-skills.md)
- `frontend/src/renderer/components/layout/GlobalContentView.tsx` — one-time grouped freeze repair

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Confirm the plugin record carries a description. If it does not, find where plugin metadata is
   read and establish whether one is available; if none exists, the Simple card shows name and
   source only, and this file records that.
2. Confirm whether plugins can be enabled/disabled from the UI. If yes, the switch is real; if no,
   render a labelled state, not a switch that does nothing.
3. Simple view via `InstallableList`, with the source line.
4. Branch `PluginsGrid.tsx` on `useUIMode()`.
5. Apply and verify the grouped delivery's amended `GlobalContentView` search suppression in Simple
   mode; keep the shell search as the only Simple search field.
6. Nerd mode: label the version, full hash on hover.
7. Empty state: no plugins installed, pointing at Marketplace.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`

Simple mode: no version string anywhere; the source is legible at body size; exactly one search
field is visible on the page; the on/off control either works or is not a switch.

Nerd mode: matches today, with a labelled version and full hash on hover.

## 9. Accessibility

- Enabled state is conveyed by text, not by the emerald/zinc colour alone —
  `PluginsGrid.tsx:60-63` already renders a text label inside the badge, so keep it.
- If the switch is real, its accessible name includes the plugin name.
- The source line is not a link unless it navigates somewhere; a non-interactive line styled like a
  link is worse than plain text.

## 10. Dependencies

Sprint 01 (`useUIMode()`), the UX-07–10 grouped shell repair, and sprint 08 (`InstallableList`).

## 11. Risks / open questions

- **Descriptions may not exist in plugin metadata.** This sprint's main improvement depends on it.
  Settle in task 1; if absent, the honest outcome is a smaller improvement, not a fabricated
  description.
- The grouped shell repair is deliberately recorded as a one-time exception because the file is
  frozen and shared with Annotations. Later page sprints must not reopen this contract.
- Truncating a hash to seven characters is conventional for git but arbitrary to everyone else.
  Keeping it Nerd-only sidesteps the question rather than answering it, which is correct here.

## 12. Shipped status

UX-10 shipped in the grouped UX-07–10 delivery. Installed-plugin records contain no descriptions,
so Simple mode shows readable name, marketplace source, and text state only. Local desktop users
get a real enable/disable action through direct API handling with visible failures; remote or
restricted views never show a nonfunctional switch. Nerd keeps the grid and now labels version
metadata while retaining the full value on hover.
