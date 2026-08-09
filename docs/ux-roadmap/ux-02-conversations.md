# UX-02 — Conversations (the Projects page)

Rail visibility: **simple-rail** ("Conversations") · Depends on: 01 · See [README.md](README.md)

## 1. Goal

Turn the project grid and session sidebar into a plain list of conversations grouped by folder,
with cost instead of token counts, and keep today's density and metrics under Nerd mode.

## 2. Today

Root is `dashboard/DashboardView/` — `index.tsx` plus `ProjectsGrid.tsx`, `RepositoryCard.tsx`,
`NewProjectCard.tsx`, `CommandSearch.tsx`. The session list beside it is `layout/Sidebar.tsx`
(which renders only when `activeActivity === 'projects'`, `Sidebar.tsx:51`) with
`layout/SidebarHeader.tsx`, `sidebar/SidebarQuickFilters.tsx`,
`sidebar/AdvancedFilterPanel.tsx`, `sidebar/ProjectList.tsx`,
`sidebar/DateGroupedSessions/` and `sidebar/SessionItem.tsx`.

Problems for a non-technical reader:

- **The card's second line is an absolute path**, rendered in `font-mono text-[10px]`
  (`RepositoryCard.tsx:84`). It is the widest piece of information on the card and means nothing
  to the target audience.
- **"12 sessions"** (`RepositoryCard.tsx:96`) uses the app's word, not the user's. So does the
  worktree count next to it — "worktree" is a git term.
- **Session rows lead with token counts.** `SessionItem.tsx` renders
  `formatTokensCompact(contextConsumption)` inline (`:59, :68`) and a hover card reading
  `Total Context: … tokens`, a per-phase breakdown, and `(compacted to …)` (`:72-83`). Every one of
  those is a nerd concept.
- **Unexplained warning glyphs.** `SessionItem.tsx:252` shows an amber marker titled
  `"Duration outlier: wall time exceeds p95 × 1.5"`. A statistical outlier flag, in a tooltip, in
  a list a beginner is scanning.
- **"Back to projects" and "Collapse sidebar"** are icon-only buttons with `title` attributes
  (`SidebarHeader.tsx:184, 208`); the section header is an uppercase 10px label
  (`DashboardView/index.tsx:32`) that reads as decoration rather than as the page's title.
- **Two search boxes, different scopes.** `DashboardView/index.tsx:27` has
  `placeholder="Search projects..."`; the sidebar has its own filters. After sprint 01 there is
  also a shell search field. A beginner cannot tell which one searches what.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Conversations                                               |
|                                                              |
|  my-project                                                  |
|  +--------------------------------------------------------+  |
|  |  Fixing the login bug                    2 hours ago   |  |
|  |  18 messages  ·  about $0.40                           |  |
|  +--------------------------------------------------------+  |
|  |  Adding dark mode                        yesterday     |  |
|  |  7 messages   ·  about $0.12                           |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  another-project                                             |
|  +--------------------------------------------------------+  |
|  |  Trying the new API                      3 days ago    |  |
|  |  4 messages   ·  about $0.05                           |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  (no conversations yet)                                      |
|   Open a folder in Claude Code and it appears here.          |
+--------------------------------------------------------------+
```

Rules:

- **One list, not a grid of cards plus a sidebar.** Conversations grouped under their folder name.
  The card/sidebar split is a power-user layout; Simple mode flattens it.
- Each row: what the conversation was about, when, visible main-thread message count, and roughly
  what it cost. A dedicated, cursor-paginated global feed supplies this metadata through a bounded
  light Rust scan; only the requested page is enriched.
- **Folder name only — never the absolute path.** No worktree count, no session ID.
- Cost in currency, never tokens. "about $0.40" — the approximation is honest and readable. Cost
  is optional: tokenless, malformed, or otherwise unpriceable rows remain usable with their
  subject, time, and message count.
- No outlier glyphs, no compaction markers, no phase breakdowns.
- No local conversation search input. A non-empty shell query routes to global SearchView.
- Empty state is a sentence that tells the user what to do, not an empty grid.

## 4. Nerd view

Today's layout, unchanged: the project grid with `RepositoryCard`s, the sidebar with quick
filters, the advanced filter panel, date grouping, virtual scrolling. Additions rather than
removals — the token hover card opens on focus as well as hover, and the outlier marker gets a
visible label instead of a `title`-only tooltip.

```
+----------------------+---------------------------------------+
|  Sessions   [filter] |  Projects                             |
|                      |                                       |
|  Today               |  +-------------+  +-------------+     |
|   session-a   1.2M   |  | my-project  |  | another     |     |
|   session-b   840K   |  | /Users/...  |  | /Users/...  |     |
|                      |  | 2 wt · 12 s |  | 1 wt · 3 s  |     |
|  Yesterday           |  +-------------+  +-------------+     |
|   session-c   2.1M ! |                                       |
+----------------------+---------------------------------------+
```

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Projects | Conversations | Projects |
| Session | Conversation | Session |
| `/Users/x/code/my-project` | — (folder name only) | absolute path, as today |
| 12 sessions | 12 conversations | 12 sessions |
| 2 worktrees | — (hidden) | 2 worktrees |
| `1.2M` (tokens) | about $0.40 | 1.2M tokens |
| Total Context: … tokens | — (hidden) | Total Context: … tokens |
| (compacted to …) | "Older messages were summarised" | (compacted to …) |
| Duration outlier: wall time exceeds p95 × 1.5 | — (hidden) | "Unusually long — 1.5× the 95th percentile" |
| No recent activity | "Nothing yet" | No recent activity |

## 6. Files touched

- `src-tauri/src/analytics/session_scan.rs`, `src-tauri/src/analytics/cost.rs`,
  `src-tauri/src/commands/session.rs`, and `src-tauri/src/types/domain.rs` — bounded light session
  summaries, current first-party list-price estimates, and cursor-paginated global feed metadata.
- `frontend/src/renderer/components/dashboard/DashboardView/index.tsx`
- `frontend/src/renderer/components/dashboard/DashboardView/RepositoryCard.tsx`
- `frontend/src/renderer/components/dashboard/DashboardView/ProjectsGrid.tsx`
- `frontend/src/renderer/components/dashboard/ConversationList.tsx` **(new)** — the Simple list
- `frontend/src/renderer/components/layout/Sidebar.tsx`
- `frontend/src/renderer/components/layout/SidebarHeader.tsx`
- `frontend/src/renderer/components/sidebar/SessionItem.tsx`
- `frontend/src/renderer/components/sidebar/SidebarQuickFilters.tsx`

Cost formatting: reuse whatever `dashboard/dashboardFormatters.ts` already provides rather than
adding a second money formatter. If it has none, add one there — not in a component.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Use the dedicated global conversation feed from bounded light Rust summaries. It returns subject,
   preview, agent metadata, visible main-thread count, and optional approximate cost without a
   second preview scan; retain current first-party list-price rules in the shared cost resolver.
2. `ConversationList.tsx` — Simple-only grouped list backed only by that global feed. Flatten
   headings and rows into one discriminated sequence; use one `@tanstack/react-virtual` virtualizer
   after 100 rendered items and request the next global page from its end sentinel.
3. Branch `DashboardView/index.tsx` on `useUIMode()`: Simple renders `ConversationList`, Nerd
   renders today's grid.
4. `Sidebar.tsx` — unmount in Simple; leave Nerd unchanged.
5. `SessionItem.tsx` — preserve Nerd row geometry, while adding keyboard access and a visible
   meaning for its outlier indicator.
6. Empty and error states for both modes, in plain language for Simple. When approximate cost is
   unavailable, leave the row usable rather than failing or hiding it.
7. Simple mounts no DashboardView or ConversationList search input. The shell field routes
   non-empty queries to global SearchView; keep Nerd project search and page-local filters where
   they already belong.

## 8. Verification / acceptance

- `bun run typecheck`
- `bun run test` — Bun-native pure list/grouping and store/feed tests.
- `bun run qa`

Manual Tauri verification, Simple mode:

- No absolute path, token count, "worktree", session ID, model ID, outlier glyph, or local search
  input appears on the page.
- Conversations are grouped by folder name and ordered most-recent-first.
- Rows use truthful visible-turn metadata and current approximate public-list-price cost when
  available; unavailable cost does not make a row unusable.
- With no projects, the empty state tells the user what to do.
- Exactly one search field is visible (the shell's), and a non-empty query opens global SearchView.

Manual Tauri verification, Nerd mode:

- The page is visually identical to today apart from accessible outlier meaning.
- Filters, presets, date grouping and virtual scrolling still work.

## 9. Accessibility

- Conversation rows are a real list (`<ul>`/`<li>` or `role="list"`), each row one tab stop with an
  accessible name that includes the subject and the relative time.
- The token hover card in Nerd mode opens on keyboard focus, not hover alone.
- The outlier marker's meaning is not conveyed by amber colour alone.
- Group headings are real headings, so a screen reader can jump between folders.

## 10. Dependencies

Sprint 01 — `useUIMode()`, and the shell search field this sprint defers to.

## 11. Risks / open questions

- **Cost is derived, not recorded.** Rows show "about $0.40" from retained usage and current
  first-party public pricing. Cost is intentionally optional: a tokenless, malformed, oversized, or
  non-finite-cost session keeps its otherwise usable row rather than receiving invented currency.
- Unmounting the sidebar in Simple removes filter presets. This is intentional: shell-global search
  searches across content through SearchView, rather than adding a ConversationList-local filter.
- `SessionItem`'s height is pinned to `SESSION_HEIGHT` (48px) for virtual scrolling
  (`SessionItem.tsx:220`). Nerd row changes must keep that in sync or the list mis-positions.
