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

- Existing records carry no reliable severity or actionability metadata, so Simple uses one
  reverse-chronological list rather than inventing a "Needs attention" group.
- Each item says what happened in plain language, which conversation it belongs to, and when.
- Items with both project and session IDs carry the action — "Open conversation" — rather than
  leaving the user to work out the next step. Synthetic records remain readable without a false
  action.
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
- `frontend/src/renderer/components/notifications/AlertList.tsx` **(new)** — the Simple list,
  pagination sentinel, empty states, and live-region announcement
- `frontend/src/renderer/components/notifications/NotificationRow.tsx`
- `frontend/src/renderer/components/notifications/alertPresentation.ts` **(new)**
- `frontend/src/renderer/components/notifications/alertPresentation.test.ts` **(new)**
- `frontend/src/renderer/store/listeners/notifications.ts`
- `frontend/src/renderer/store/slices/notificationSlice.ts`
- `frontend/src/renderer/store/slices/notificationSlice.test.ts` **(new)**

Reuse `ConfirmDialog` (already mounted in `App.tsx:60`) for the Nerd-mode `Clear all`; do not add a
second dialog implementation.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `NotificationsView.tsx` fully and the notification record shape in
   `frontend/src/shared/types/notifications/`. Establish which records are actionable — that
   distinction drives the whole Simple layout.
2. Confirm whether records carry honest severity/actionability metadata. They do not, so use the
   documented reverse-chronological fallback and expose actions only for records with valid targets.
3. `AlertList.tsx` — the Simple list, plain-language text, conditional conversation action, and
   incremental earlier-page loading.
4. Branch `NotificationsView.tsx` on `useUIMode()`.
5. Simple header: one labelled "Mark all read" button. No clear action.
6. Empty state with the two distinct cases, including the "turn them on" path.
7. Nerd mode: visible filter chips, labelled icon buttons, `Clear all` behind `ConfirmDialog`.
8. Keep the rail's unread badge consistent with the server unread total shown in Simple mode;
   loaded-row count is not presented as total history while earlier pages remain available.

## 8. Verification / acceptance

- Focused Alerts checks: `bun test src/renderer/store/slices/notificationSlice.test.ts src/renderer/components/notifications/alertPresentation.test.ts`
- Full frontend checks: `bun run test`
- Repository typecheck: `bun run typecheck` (currently has the pre-existing `markdownTextSearch.ts` dependency/type errors recorded in the grouped handoff)

Simple mode:

- Alerts render in reverse chronological order; records with valid targets carry an action button,
  while synthetic records remain readable without one.
- No "Clear all" or "Clear filtered" anywhere.
- With no enabled triggers, the empty state says so and offers notification settings; no-records
  state remains distinct.
- The page shows the server unread total, including while earlier history is still loading.

Nerd mode:

- Filter state is visible; "Clear filtered" is unambiguous.
- `Clear all` asks for confirmation before destroying anything.

## 9. Accessibility

- New alerts are announced through a polite live region — not an assertive one, which would
  interrupt.
- The Simple list has a labelled list region; it does not invent severity markers or headings for
  metadata the records do not carry.
- Every action button has a visible text label in Simple mode and at minimum an `aria-label` in
  Nerd mode.
- The unread badge's count is in the rail item's accessible name, which `ActivityBar.tsx:61`
  already does — keep it.

## 10. Dependencies

Sprint 01 (`useUIMode()`, and the rail badge). Uses sprint 02's session-subject resolution.

## 11. Risks / open questions

- **Severity/actionability metadata is not present in existing records.** UX-06 therefore ships
  the documented reverse-chronological fallback and only offers conversation navigation when both
  target IDs are present. Exact severity grouping remains future data-contract work.
- Dropping "Clear all" from Simple mode means a user with thousands of read notifications has no
  way to prune them there. Existing retention bounds in `AppConfig.notifications`
  (`retentionDays`, `maxCount`) remain the cleanup path; Simple does not imply all history is loaded.
- The rail badge and page use the server unread total, while loaded rows remain an explicitly partial
  view until earlier pages finish loading.

## 12. Shipped status

UX-06 shipped in the grouped UX-04–06 delivery. Notification state now supports deduplicated
recent-page plus earlier-page loading, live prepends without a 200-record truncation, separate
initial/append failures, and server-authoritative unread counts. Simple Alerts uses sanitized
reverse chronology with conditional conversation actions; Nerd retains filters and confirmed
clear actions.
