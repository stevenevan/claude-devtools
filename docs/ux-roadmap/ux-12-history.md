# UX-12 — History

Rail visibility: **behind-More** ("Things you asked") · Depends on: 01 · See [README.md](README.md)

## 1. Goal

Make the prompt history answer "what did I ask before?" — searchable, grouped by day, and reusable —
rather than presenting a log of entries.

## 2. Today

Root is `dashboard/HistoryBrowser.tsx` (334 lines), reading `~/.claude/history.jsonl`. It has a
search field with `aria-label="Search prompts and projects"` and
`placeholder="Search prompts and projects..."` (`:166-169`), a project filter defaulting to
`"All projects"` (`:176-179`), a list labelled `aria-label="History entries"` (`:205`), and two empty
states: `'No history entries found.'` and `'No entries match this project filter.'` (`:217-218`).

The accessibility work here is already better than most of the app — the search field and the list
both have proper labels.

Problems for a non-technical reader:

- **"History entries"** is the file's vocabulary. The user asked things; the app stored entries.
- **No grouping.** A flat reverse-chronological list of every prompt ever typed, with no day
  boundaries, so there is no sense of "yesterday" versus "three months ago".
- **Nothing to do with an entry.** You can find a prompt you wrote and then... look at it. There is
  no copy, no "ask this again", no jump to the conversation it belonged to.
- **The project filter shows project identifiers**, not folder names a user would recognise.
- **Two empty states, both dead ends.** Neither says what to do next.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Things you asked                                            |
|                                                              |
|  [ search what you asked                              ]      |
|  [ All folders  v ]                                          |
|                                                              |
|  Today                                                       |
|  +--------------------------------------------------------+  |
|  |  "fix the login page, it throws on submit"              |  |
|  |  my-project  ·  2 hours ago            [ Copy ]         |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Yesterday                                                   |
|  +--------------------------------------------------------+  |
|  |  "add dark mode to the settings page"                   |  |
|  |  my-project  ·  yesterday              [ Copy ]         |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Earlier                                                     |
|  +--------------------------------------------------------+  |
|  |  "what does this regex do"                              |  |
|  |  another-project  ·  12 March          [ Copy ]         |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Nothing found                                               |
|   Try a different word, or clear the folder filter.          |
+--------------------------------------------------------------+
```

Rules:

- **Grouped by day**: Today, Yesterday, then Earlier with dates. Reuse
  `frontend/src/renderer/utils/dateGrouping.ts` — it already exists and the sidebar already groups
  sessions with it.
- The prompt text leads. It is what the user recognises.
- **"Copy" on every row.** The most likely reason to visit this page is to reuse something you wrote,
  and copying it is the one action that always works.
- The folder filter shows **folder names**, not project identifiers.
- Empty state suggests a next step — the current "No entries match this project filter" states the
  problem and stops.
- Relative dates in Simple; absolute in Nerd.

## 4. Nerd view

Today's page, unchanged: full search across prompts and projects, the project filter, the flat list,
existing labels. Additions: day grouping is available here too (it is an improvement in both modes),
and each row gains a jump to the conversation it came from when the record carries a session
reference.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| History | Things you asked | History |
| History entries | (no label needed — the prompts are the list) | History entries |
| Search prompts and projects… | "search what you asked" | Search prompts and projects… |
| All projects | All folders | All projects |
| Project identifier | folder name | project identifier |
| No history entries found. | "Nothing here yet" + what creates entries | No history entries found. |
| No entries match this project filter. | "Nothing found" + suggested next step | as today |

## 6. Files touched

- `frontend/src/renderer/components/dashboard/HistoryBrowser.tsx`
- `frontend/src/renderer/components/dashboard/historyBrowserHelpers.ts` **(new)** — grouping and
  folder-label helpers
- `frontend/src/renderer/components/dashboard/historyBrowserHelpers.test.ts` **(new)**
- `frontend/src/renderer/components/common/CopyButton.tsx` — accessible copy feedback
- `frontend/src/renderer/utils/dateGrouping.ts` and its tests — reuse; extend only if it cannot
  group this shape

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `dateGrouping.ts` and its tests; reuse it rather than writing a second grouping. It is
   already covered by `test/renderer/utils/dateGrouping.test.ts`.
2. Day grouping in the list, both modes.
3. Copy action per row, using the existing `common/CopyButton` component.
4. Folder-name display in the project filter.
5. Branch labels and date formatting on `useUIMode()`.
6. Both empty states rewritten with a next step.
7. Nerd mode: jump-to-conversation where the record supports it.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`
- `bun run test -- dateGrouping` — grouping is reused, so its tests must still pass.

Simple mode: entries are grouped by day with Today/Yesterday/Earlier headings; every row has a
working Copy; the filter lists folder names; both empty states suggest a next step; no project
identifier appears.

Nerd mode: search and filter behave as today; grouping is present; absolute dates.

## 9. Accessibility

- Keep the existing `aria-label="Search prompts and projects"` and the labelled list — this page
  already does this correctly; do not regress it while restructuring.
- Day headings are real headings so they can be navigated between.
- Copy buttons have accessible names identifying which prompt they copy, not a bare "Copy" repeated
  down the list.
- Copy reports success in a live region; a button that silently succeeds is indistinguishable from
  one that failed.

## 10. Dependencies

Sprint 01.

## 11. Risks / open questions

- **`history.jsonl` is Claude Code's format and may drift.** The reader must stay tolerant: skip a
  malformed record with a labelled row rather than failing the whole list. That is the existing
  convention for `~/.claude` readers in this repo and it applies here.
- Whether a history record carries a session reference determines if jump-to-conversation is
  possible. Check before promising it; if absent, Nerd mode gets Copy only, same as Simple.
- This page can be long — every prompt ever typed. Confirm it virtualises; if it does not and the
  list is large, day grouping makes the DOM bigger, not smaller. Use
  `@tanstack/react-virtual` as the repo does elsewhere for lists over ~100 rows.

## 12. Shipped status

UX-12 shipped in the grouped UX-11–12 delivery. Both modes group prompts by local day and provide
an accessible Copy action on every row with live success feedback. Simple mode uses “Things you
asked”, folder names, relative dates, and actionable empty states; Nerd mode keeps raw project
values and absolute timestamps. The existing virtualized list now includes stable day headings.
History records contain no session reference, so no jump action was added; the detail view remains
available after selecting a row.
