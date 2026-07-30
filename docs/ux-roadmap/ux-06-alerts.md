# UX-06 — Alerts (the Notifications page)

Rail visibility: **simple-rail** ("Alerts") · Depends on: 01 · See [README.md](README.md)

## 1. Goal

Make the notification list say what happened and what to do about it, and keep the trigger-rule
machinery in Nerd mode where it belongs.

## 2. Today

Root is `notifications/NotificationsView.tsx` (315 lines). Header reads "Notifications"
(`:186`); actions are icon buttons titled `'Mark filtered as read'` / `'Mark all as read'`
(`:206`) and `'Clear filtered'` / `'Clear all'` (`:223`); the empty state is
`'No matching notifications'` / `'No notifications'` (`:271`). Configuration lives elsewhere, in
`settings/NotificationTriggerSettings/`, which is a form-heavy subsystem of its own.

Problems for a non-technical reader:

- **A filter model with no visible filter.** The header's actions change meaning depending on
  whether `activeFilter` is set — "Clear filtered" versus "Clear all" — but the filter itself is
  not prominent, so the same button appears to do two different things on different visits.
- **Notification text is event text.** Items describe what fired, in the vocabulary of the trigger
  that fired it, not what it means for the user or whether it needs action.
- **No grouping and no priority.** An error worth attention and a routine completion sit in the
  same flat list with the same weight.
- **Destructive actions are icon-only.** "Clear all" is a `title` on an icon button. Clearing every
  notification is not recoverable, and the affordance is smaller than the risk.
- **"No notifications" is ambiguous** — it does not distinguish "nothing has happened" from
  "notifications are switched off", and the latter is a real state with a real fix.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Alerts                                     [ Mark all read ]|
|                                                              |
|  Needs attention                                             |
|  +--------------------------------------------------------+  |
|  |  !  Claude stopped with an error                       |  |
|  |     Fixing the login bug  ·  10 minutes ago            |  |
|  |     [ Open conversation ]                              |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Earlier today                                               |
|  +--------------------------------------------------------+  |
|  |     Finished working on "Adding dark mode"             |  |
|  |     2 hours ago                                        |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  All caught up                                               |
|   You will see a note here when Claude needs you or          |
|   finishes something.                                        |
|                                                              |
|   (or) Alerts are turned off.  [ Turn them on ]              |
+--------------------------------------------------------------+
```

Rules:

- **Two groups: Needs attention, then Earlier.** Anything actionable is above anything
  informational.
- Each item says what happened in plain language, which conversation it belongs to, and when.
- **Actionable items carry the action** — "Open conversation" — rather than leaving the user to
  work out the next step.
- One primary action in the header: "Mark all read", with a visible text label.
- **"Clear all" is not in Simple mode.** It is irreversible and its only benefit is tidiness;
  marking as read achieves what the user wants. It stays in Nerd mode, with a confirmation.
- The empty state distinguishes "nothing happened" from "alerts are off", and in the second case
  offers the fix.
- No trigger-rule configuration on this page; it lives in Settings.

## 4. Nerd view

Today's page, plus the filter made explicit: visible filter chips showing what is being filtered,
so the header's "Clear filtered" reads unambiguously. Icon-only actions gain labels.
`Clear all` gains a confirmation dialog — it is destructive, and `ConfirmDialog` is already mounted
in `App.tsx:60`.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Notifications | Alerts | Notifications |
| Mark all as read | Mark all read | Mark all as read |
| Clear all | — (not offered) | Clear all (with confirmation) |
| Clear filtered | — (not offered) | Clear filtered |
| No notifications | "All caught up" / "Alerts are turned off" | No notifications |
| No matching notifications | — (no filter in Simple) | No matching notifications |
| Trigger | — (hidden) | Trigger |
| Subagent error | Helper ran into a problem | Subagent error |
| Session `abc123-…` | conversation subject | subject + session ID |

## 6. Files touched

- `frontend/src/renderer/components/notifications/NotificationsView.tsx`
- `frontend/src/renderer/components/notifications/AlertList.tsx` **(new)** — the Simple grouping
- `frontend/src/renderer/components/notifications/` — badge components, for consistency with the
  rail's unread count

Reuse `ConfirmDialog` (already mounted in `App.tsx:60`) for the Nerd-mode `Clear all`; do not add a
second dialog implementation.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `NotificationsView.tsx` fully and the notification record shape in
   `frontend/src/shared/types/notifications/`. Establish which records are actionable — that
   distinction drives the whole Simple layout.
2. Classify: actionable versus informational. If the record type does not already say, derive it
   from the trigger kind and record the mapping in this file.
3. `AlertList.tsx` — two groups, plain-language text, inline action on actionable items.
4. Branch `NotificationsView.tsx` on `useUIMode()`.
5. Simple header: one labelled "Mark all read" button. No clear action.
6. Empty state with the two distinct cases, including the "turn them on" path.
7. Nerd mode: visible filter chips, labelled icon buttons, `Clear all` behind `ConfirmDialog`.
8. Keep the rail's unread badge consistent with what Simple mode shows — if Simple hides a
   category, the badge must not count it.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`
- `bun run test -- notificationSlice` — the store slice has coverage; grouping changes must not
  break it.

Simple mode:

- Actionable alerts appear above informational ones, and carry an action button.
- No "Clear all" or "Clear filtered" anywhere.
- With notifications disabled, the empty state says so and offers to enable them.
- The rail badge count matches the number of unread items the page actually shows.

Nerd mode:

- Filter state is visible; "Clear filtered" is unambiguous.
- `Clear all` asks for confirmation before destroying anything.

## 9. Accessibility

- New alerts are announced through a polite live region — not an assertive one, which would
  interrupt.
- Group headings are real headings; the two groups are labelled regions.
- The `!` marker is decorative (`aria-hidden`); severity is carried in the item's text.
- Every action button has a visible text label in Simple mode and at minimum an `aria-label` in
  Nerd mode.
- The unread badge's count is in the rail item's accessible name, which `ActivityBar.tsx:61`
  already does — keep it.

## 10. Dependencies

Sprint 01 (`useUIMode()`, and the rail badge). Uses sprint 02's session-subject resolution.

## 11. Risks / open questions

- **The actionable/informational split may not exist in the data.** If notification records carry
  no severity or kind that maps cleanly, this sprint's core grouping is guesswork. Settle it in
  task 2 by reading the trigger types, and if no honest mapping exists, fall back to a single
  reverse-chronological list with actions on the items that have a target — do not fake a
  severity.
- Dropping "Clear all" from Simple mode means a user with thousands of read notifications has no
  way to prune them there. The retention bounds in `AppConfig.notifications`
  (`retentionDays`, `maxCount`) already auto-prune, which is the honest answer — confirm they are
  active before relying on it.
- The rail badge and the page must agree. Two counts that differ by one is the kind of detail that
  makes an app feel broken.
