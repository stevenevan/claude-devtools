# UX-11 — Annotations

Rail visibility: **behind-More** ("Your notes") · Depends on: 01, 03 · See [README.md](README.md)

## 1. Goal

Turn a list of orphaned notes into notes attached to conversations you can get back to, and make
deleting one recoverable enough to be safe.

## 2. Today

Root is `sidebar/AnnotationList.tsx` (125 lines), rendered inside `GlobalContentView` with the
title "Annotations" (`layout/PaneContent.tsx:118-121`). It has one destructive action, an icon
button titled `"Remove annotation"` (`AnnotationList.tsx:119`). Annotations are authored elsewhere —
`sidebar/SessionTagEditor.tsx` and the session view — so this page is a reader.

Problems for a non-technical reader:

- **"Annotation" is a technical word for a note.** Nothing on the page explains what one is or how
  to make one.
- **Notes are listed without enough context to be useful.** A note that says "check this" is
  worthless unless you can see which conversation it was on and get back there.
- **Delete is an icon with a `title`, and it is immediate.** One misclick destroys a note the user
  wrote by hand, with no undo. This is the most user-authored data on any page in the app, and it has
  the weakest protection.
- **The page lives in a component directory called `sidebar/`** while being a full page — a
  structural oddity that makes it easy to miss when changing page conventions.
- **Two search fields** after sprint 01, for the same reason as [ux-10](ux-10-plugins.md) §4.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Your notes                                                  |
|                                                              |
|  Notes you have left on conversations show up here.          |
|                                                              |
|  +--------------------------------------------------------+  |
|  |  "check whether this handles the empty case"            |  |
|  |  on Fixing the login bug  ·  2 hours ago                |  |
|  |  [ Open conversation ]                      [ Delete ]  |  |
|  +--------------------------------------------------------+  |
|  |  "ask about the rate limit"                             |  |
|  |  on Trying the new API  ·  yesterday                    |  |
|  |  [ Open conversation ]                      [ Delete ]  |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  No notes yet                                                |
|   While reading a conversation, add a note to remember       |
|   something about it.                                        |
+--------------------------------------------------------------+
```

Rules:

- **The note's own text leads.** It is the only thing on the page the user wrote; it gets the
  emphasis.
- Each note names the conversation it is on **by subject** and when it was made.
- **"Open conversation" is the primary action.** A note whose context you cannot reach is a note you
  cannot act on.
- **Delete is a labelled button with a confirmation**, not an icon with a `title`. This is
  hand-written data; the confirmation is not bureaucracy.
- Empty state explains where notes come from, which is the one thing the current page never says.
- One search field (the shell's).

## 4. Nerd view

Today's density, plus the same two improvements: the conversation subject rather than an ID, and a
confirmation on delete. The icon-only delete button gains an `aria-label` either way.

Deleting user-authored data without confirmation is not a mode preference — the confirmation
applies in both modes. Nerd mode gets a terser dialog, not no dialog.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Annotations | Your notes | Annotations |
| Annotation | Note | Annotation |
| Remove annotation | Delete | Remove annotation |
| Session `abc123-…` | conversation subject | subject + session ID |
| (no timestamp shown) | relative time | absolute timestamp |

## 6. Files touched

- `frontend/src/renderer/components/sidebar/AnnotationList.tsx`
- `frontend/src/renderer/components/layout/GlobalContentView.tsx` and
  `frontend/src/renderer/components/layout/PaneContent.tsx` — the documented title-only shell
  exception
- `frontend/src/renderer/store/slices/annotationSlice.ts` and
  `frontend/src/renderer/store/slices/annotationSlice.test.ts`
- `src-tauri/src/config/state/manager.rs` and `src-tauri/src/commands/config.rs` — safe persisted
  deletion

Reuse `ConfirmDialog` (mounted in `App.tsx:60`) for the delete confirmation.

Leave the file where it is. Moving it out of `sidebar/` is a rename with no user-visible benefit,
and this roadmap's non-goals rule out refactors that do not trace to the request. Note the oddity in
this file and move on.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `AnnotationList.tsx` and the annotation record shape; confirm it carries a session reference
   and a timestamp.
2. Row content per §3: note text leading, conversation subject, relative time.
3. "Open conversation" navigating to the session — and, if the annotation records a position, to that
   point in it.
4. Delete behind `ConfirmDialog`, in **both** modes, with a labelled button in Simple.
5. Branch on `useUIMode()` for label vocabulary and density.
6. Empty state explaining where notes come from.
7. Verify sprint 01 suppressed `GlobalContentView`'s search field in Simple mode.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`

Both modes: deleting a note asks for confirmation first; the delete control has an accessible name.

Simple mode: the note text is the most prominent element; each note names its conversation by
subject and offers "Open conversation"; the empty state says how to create a note; one search field.

Nerd mode: density matches today; session ID and absolute timestamp available.

## 9. Accessibility

- Notes are a list; each note's accessible name starts with its text, not with "Annotation".
- The delete button has an `aria-label` including which note it deletes — "Delete" alone, repeated
  down a list, is unusable with a screen reader.
- The confirmation dialog takes focus, does not initially focus the destructive button, and returns
  focus on close.
- Note text is user-authored and may be long; it wraps rather than truncating to an ellipsis with no
  way to read the rest.

## 10. Dependencies

Sprint 01 (`useUIMode()`, `GlobalContentView` suppression), sprint 03 (navigating into a
conversation at a position).

## 11. Risks / open questions

- **The annotation record may not reference a session position**, only a session. Then "Open
  conversation" opens at the top, which is still better than nowhere. Do not fake a position.
- If annotations are stored per session in config rather than in their own store, deleting one is a
  config write and inherits `sync_autostart`-style side effects. Check the write path before
  assuming delete is cheap.
- This page is the app's only user-authored content. If a future sprint adds bulk delete, it needs
  undo, not just a confirmation — flagged here so it is not added casually.

## 12. Shipped status

UX-11 shipped in the grouped UX-11–12 delivery. Simple mode presents notes with conversation
subjects, relative times, an Open conversation action, and a confirmed Delete action; Nerd mode
retains session IDs and absolute timestamps. Failed config writes are surfaced while the note stays
present in memory. Annotation records carry a session but no position, so opening a note starts at
the conversation top. The frozen shell received only the documented title-only exception: Simple
shows “Your notes” while the existing search behavior remains unchanged.
