# UX-05 — Tasks (the Todos page)

Rail visibility: **simple-rail** ("Tasks") · Depends on: 01 · See [README.md](README.md)

## 1. Goal

Show what Claude is working on and what it finished, as a list a person can scan, without needing
to know which session a task came from.

## 2. Today

Root is `dashboard/TodosDashboard.tsx` (247 lines). It renders an `<h1>Todos</h1>`
(`TodosDashboard.tsx:108`) and groups items by status, with `'In progress'` among the state labels
(`:128`).

Problems for a non-technical reader:

- **"Todos" is the app's word for it.** Claude Code writes a todo list per session; the page
  surfaces that data structure directly, including its name.
- **Status is the primary grouping, session is secondary.** A user thinks "what is happening right
  now", not "show me all items in state `in_progress` across every session".
- **No sense of time.** Nothing says whether an in-progress task started a minute ago or was
  abandoned three days back — which is the difference between "working" and "stuck".
- **Session identity leaks.** Task rows carry the session they belong to, and a session is
  identified by an ID rather than by what the conversation was about.
- **Empty state is structural.** With no todos the page renders its scaffolding rather than saying
  there is nothing to do.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Tasks                                                       |
|                                                              |
|  Happening now                                               |
|  +--------------------------------------------------------+  |
|  |  o  Add a test for the login fix                       |  |
|  |     Fixing the login bug  ·  started 4 minutes ago     |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Waiting                                                     |
|  +--------------------------------------------------------+  |
|  |  .  Update the changelog                               |  |
|  |     Fixing the login bug                               |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Done today                                                  |
|  +--------------------------------------------------------+  |
|  |  v  Fix the submit handler                             |  |
|  |     Fixing the login bug  ·  2 hours ago               |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Nothing to show                                             |
|   Tasks appear here while Claude is working.                 |
+--------------------------------------------------------------+
```

Rules:

- **Three groups, in this order: Happening now, Waiting, Done today.** Anything finished before
  today is behind a "show earlier" control — a list that grows forever is a list nobody reads.
- Each row: what the task is, which conversation it came from **by subject, not by ID**, and when.
- "Started 4 minutes ago" on in-progress items. That is the signal that separates working from
  stuck.
- Clicking a row opens that conversation at the relevant point — the task list is a way in, not a
  dead end.
- Empty state is a sentence.

## 4. Nerd view

Today's grouping and density, plus what is currently missing: the session ID alongside the
subject, exact timestamps on hover, and the raw status value where the Simple label paraphrases it.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Todos | Tasks | Todos |
| `in_progress` / In progress | Happening now | In progress (`in_progress`) |
| `pending` | Waiting | Pending (`pending`) |
| `completed` | Done | Completed (`completed`) |
| Session `abc123-…` | conversation subject | subject + session ID |
| (no time shown) | "started 4 minutes ago" | absolute timestamp |

## 6. Files touched

- `frontend/src/renderer/components/dashboard/TodosDashboard.tsx`
- `frontend/src/renderer/components/dashboard/TaskList.tsx` **(new)** — the Simple grouping, if
  `TodosDashboard.tsx` would exceed ~300 lines otherwise
- `frontend/src/renderer/utils/formatters.ts` — relative-time helper, if one is not already there

Session subject lookup should reuse whatever sprint 02 uses for the conversation row; do not add a
second resolver.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `TodosDashboard.tsx` fully and find where status grouping happens; establish whether the
   session subject is already available on the todo record or needs a lookup.
2. Regroup for Simple mode: Happening now / Waiting / Done today, with "show earlier" for the rest.
3. Row content per §3, using the conversation subject rather than the session ID.
4. Relative start time on in-progress items.
5. Row click navigates to the conversation.
6. Empty state, both modes.
7. Nerd mode: session ID and raw status restored alongside the labels.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`
- `bun run test:task-filtering` — this page consumes task data and that suite covers its filtering.

Simple mode:

- Three groups in the stated order; finished-before-today is collapsed behind one control.
- No session ID and no raw status string anywhere.
- An in-progress task shows how long it has been running.
- Clicking a row lands in the right conversation.
- With no tasks, the page says so in a sentence.

Nerd mode:

- Grouping and density match today; IDs and raw status values are visible.

## 9. Accessibility

- Each group is a labelled region with a real heading.
- Status is conveyed by text, not by the glyph or colour alone — the `o` / `.` / `v` marks in the
  wireframe are decoration and carry `aria-hidden`.
- Rows are buttons or links, not clickable `div`s, so keyboard activation works.
- "Show earlier" reports how many items it reveals.

## 10. Dependencies

Sprint 01 (`useUIMode()`). Uses sprint 02's session-subject resolution.

## 11. Risks / open questions

- **The session subject may not exist.** Claude Code's todo records may carry only a session ID. If
  no subject is derivable, Simple mode shows the folder name and the time instead — it does not
  show the ID, and it does not invent a subject.
- "Done today" depends on a completion timestamp. If todo records carry no completion time, group
  by last-modified and say "recently done" rather than implying precision that is not there.
- Stale in-progress tasks are common — a session that ended mid-task leaves an item that will never
  complete. Consider showing "started 3 days ago" plainly rather than filtering it out; a stuck task
  the user can see is better than one silently hidden.
