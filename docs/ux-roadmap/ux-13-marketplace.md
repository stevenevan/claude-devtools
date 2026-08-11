# UX-13 — Marketplace

Rail visibility: **behind-More** ("Find add-ons") · Depends on: 01, 10 · See [README.md](README.md)

## 1. Goal

Make browsing and installing an add-on a two-step process a non-technical user can complete, without
hiding where the code comes from.

## 2. Today

Root is `dashboard/MarketplaceBrowser.tsx` (310 lines), with a list labelled
`aria-label="Marketplaces"` (`:87`) and a `title="Copy command"` action (`:296`).

Problems for a non-technical reader:

- **The primary action is "copy a command".** The install path is: copy a CLI command, leave the app,
  open a terminal, paste it. Every step after the first is outside the app, and the second step
  assumes the user has a terminal and knows what to do with it.
- **"Marketplace" is unexplained**, and the page lists marketplaces before it lists anything
  installable — so the first decision a user makes is one they have no basis for.
- **No trust signals.** Installing a plugin runs third-party code. The page shows a name and a
  source, and nothing that helps a cautious user decide.
- **No installed state.** Nothing distinguishes an add-on you already have from one you do not, so
  the page and [ux-10](ux-10-plugins.md) tell overlapping stories.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Find add-ons                                                |
|                                                              |
|  Add-ons come from other people. Only install ones you       |
|  trust — they can read and change your files.                |
|                                                              |
|  [ search add-ons                                     ]      |
|                                                              |
|  +--------------------------------------------------------+  |
|  |  Context7                                installed     |  |
|  |  Looks up current library documentation                |  |
|  |  From: github.com/upstash/context7                     |  |
|  +--------------------------------------------------------+  |
|  |  Codex                                    [ Install ]  |  |
|  |  Hands work to OpenAI Codex when Claude is stuck        |  |
|  |  From: github.com/openai/codex                         |  |
|  +--------------------------------------------------------+  |
|                                                              |
+--------------------------------------------------------------+
```

Rules:

- **A standing caution at the top**, in plain language, stating the actual risk: third-party code
  that can read and change your files. Not a dismissible banner — a permanent line. This is the one
  place in the roadmap where Simple mode says *more* than Nerd mode, because the audience least able
  to evaluate the risk is the one being warned.
- **Installable things first, marketplaces as a filter** — not the reverse.
- Each row: name, one-line description, and **the source as a recognisable origin** (a repository
  URL, not an internal identifier). Provenance is a trust signal and stays visible in Simple mode,
  which is a deliberate exception to [README.md](README.md) §7's hidden-paths rule.
- **"Installed" is shown as state, not as a disabled button.**
- If the app can install without a terminal, "Install" does it, with a confirmation naming what is
  being installed and from where. **If it cannot**, the button reads "How to install" and opens
  instructions with the command and a copy control — honest about the extra step rather than
  pretending to be one click.
- Search over add-ons, not over marketplaces.

## 4. Nerd view

Today's page, unchanged: the marketplace list, the copy-command action, whatever catalogue metadata
is already shown. Additions: an installed/not-installed indicator, and the same caution as a single
line rather than a paragraph.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Marketplace | Where it comes from (a filter) | Marketplace |
| Plugin | Add-on | Plugin |
| Copy command | "How to install" (or a real Install) | Copy command |
| (no installed state) | "installed" | installed / not installed |
| Marketplace identifier | repository URL | identifier + URL |

## 6. Files touched

- `frontend/src/renderer/components/dashboard/MarketplaceBrowser.tsx`
- `frontend/src/renderer/components/dashboard/InstallableList.tsx` — reused from
  [ux-08](ux-08-skills.md)

Reuse `common/CopyButton` for the command, and `ConfirmDialog` for any real install.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. **Establish whether the app can install a plugin at all**, or whether copy-a-command is the only
   path. Read the marketplace command surface in `src-tauri/src/commands/` before designing the
   button. Everything else in this sprint depends on the answer, and guessing it wrong makes the
   primary action a lie.
2. Determine installed state by cross-referencing the installed plugin list ([ux-10](ux-10-plugins.md)'s
   data source).
3. Restructure: installables first, marketplace as a filter.
4. The caution line, in both modes.
5. Simple view via `InstallableList`, with source URL and installed state.
6. Install or How-to-install per task 1's answer, with confirmation if it is a real install.
7. Branch on `useUIMode()` for vocabulary and density.
8. Empty and error states — including the marketplace-unreachable case, which is a network error and
  must not read as "no add-ons exist".

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`
- `bun run test:rust` if task 1 leads to touching any Rust command.

Simple mode: the caution is present and not dismissible; add-ons are listed before marketplaces; each
row shows a recognisable source; already-installed add-ons are marked; the install control does what
it says — either installing, or opening honest instructions.

Nerd mode: matches today plus installed state and the caution line.

Both: a failed marketplace fetch shows a network error, not an empty list.

## 9. Accessibility

- The caution is in the page's landmark structure and read before the list, not visually-above-only.
- Installed state is text, not colour alone.
- The install confirmation names the add-on and its source in the dialog text, so a screen-reader
  user hears what they are approving.
- Search results announce their count.

## 10. Dependencies

Sprint 01, sprint 08 (`InstallableList`), sprint 10 (installed-plugin data and the "Add-ons"
vocabulary).

## 11. Risks / open questions

- **Whether in-app install exists is unresolved and load-bearing.** Task 1 settles it by reading the
  command surface. Until then, do not design the button. If install requires a terminal, say so
  plainly — a non-technical user who cannot complete the flow is better served by clear instructions
  than by a button that copies text to a clipboard they will not use.
- **This page has the roadmap's only real security surface.** Installing third-party code is the one
  action in this app that can harm the user's machine. The caution is not decoration, and a future
  sprint must not remove it for visual calm.
- If a real install exists, it writes outside `~/.claude` conventions and needs the same care as
  [ux-15](ux-15-maintenance.md)'s destructive actions. Confirm the backend's confinement before
  wiring a one-click install.
- Marketplace catalogues are fetched from third parties, so descriptions are untrusted text. Render
  them as text, never as markdown or HTML that could carry a link or a script.

## 12. Shipped status

UX-13 shipped in the grouped UX-13–15 delivery. Simple mode presents local catalog entries with
honest copy-only install instructions; no in-app install or shell execution was added.
