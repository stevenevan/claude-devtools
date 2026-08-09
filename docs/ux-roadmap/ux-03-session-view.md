# UX-03 — Session View (reading one conversation)

Rail visibility: **not-on-the-rail** (opened from a conversation) · Depends on: 01, 02 · See
[README.md](README.md)

## 1. Goal

Make one conversation readable as a conversation — what was asked, what Claude did, what came out
— with the execution-trace machinery available but folded away in Simple mode.

## 2. Today

`layout/SessionTabContent.tsx` renders `<MiddlePanel tabId={tab.id} />` (`:44`).
`layout/MiddlePanel.tsx` composes, in order: `SearchBar`, `SessionSummaryBar`, then conditionally
`ToolFlameGraph`, `TeamTreeView`, `FileGraphView`, then `ChatHistory` (`MiddlePanel.tsx:46-63`).
`chat/ChatHistory/` holds `index.tsx`, `ChatHistoryToolbar.tsx`, `ChatHistorySidePanels.tsx`,
`helpers.ts`, `useChatHistoryRefs.ts`. Individual turns render through `chat/items/` —
`TextItem`, `ThinkingItem`, `LinkedToolItem`, `SubagentItem/`, `SlashItem`, `ExecutionTrace`,
`MetricsPill`, `TeammateMessageItem` — with `chat/viewers/` for code, diffs and markdown.

This is the app's best work and its least approachable page.

Problems for a non-technical reader:

- **The reading surface competes with four analysis surfaces.** A flame graph, a team tree, a file
  graph and a context heatmap can all be on screen above the conversation
  (`MiddlePanel.tsx:48-61`, `ChatHistoryToolbar.tsx:44`). Each is toggled by an icon button whose
  only label is a `title`.
- **Thinking blocks are shown as first-class content.** `ThinkingItem` renders extended reasoning
  inline. Useful for a power user auditing a trace; confusing for someone who wants the answer.
- **Tool calls are shown as tool calls.** `LinkedToolItem` pairs a call with its result and shows
  the tool's name and raw arguments. A beginner needs "read a file", not `Read` with a JSON payload
  and an absolute path.
- **Compaction boundaries appear as markers**, not as an explanation. `CompactBoundary` tells you
  a technical event happened without saying what it means for what you are reading.
- **Metrics are interleaved with content.** `MetricsPill` puts token and timing figures inside the
  reading flow.
- **`ExecutionTrace`** is exactly what its name says — and is the single densest thing in the app.

## 3. Simple view

```
+--------------------------------------------------------------+
|  < Conversations        Fixing the login bug                 |
|  2 hours ago  ·  18 messages  ·  about $0.40                 |
+--------------------------------------------------------------+
|                                                              |
|  You                                                         |
|  The login page throws on submit. Can you fix it?            |
|                                                              |
|  Claude                                                      |
|  I looked at your login form and found the problem.          |
|                                                              |
|    > What Claude did (4 steps)                     [expand]  |
|                                                              |
|  The submit handler was missing an await, so the form        |
|  navigated before the request finished. Fixed in             |
|  LoginForm.tsx.                                              |
|                                                              |
|  ---- Older messages were summarised to save space ----      |
|                                                              |
|  You                                                         |
|  Thanks, can you add a test?                                 |
|                                                              |
+--------------------------------------------------------------+
```

Rules:

- **Two speakers, in order.** "You" and "Claude". Nothing else is a top-level element.
- **One `StepSummary` appears per assistant turn** — "What Claude did (4 steps)" — aggregating
  tools, helpers, slash commands, teammate messages, metrics, traces, and other technical children
  into plain descriptions ("read `LoginForm.tsx`", "changed 2 lines"). Raw arguments never appear;
  Bash summaries never reveal command text.
- **Thinking is hidden**, not collapsed-but-visible. It reappears in Nerd mode.
- **No flame graph, team tree, file graph, or heatmap.** Not even as toggles.
- Compaction reads as a sentence, in the flow, in muted text.
- File names, not absolute paths. A path is shown as `LoginForm.tsx` with the full path on hover in
  Nerd mode only.
- The header carries the same light-path metadata as the conversation row in sprint 02: subject,
  relative time, visible message count, and approximate cost when available. An unavailable cost
  leaves the conversation readable and the other facts intact.

## 4. Nerd view

Today's page, unchanged: `SearchBar`, `SessionSummaryBar`, all four analysis surfaces and their
toggles, thinking blocks inline, `LinkedToolItem` with names and arguments, `MetricsPill`,
`ExecutionTrace`, `CompactBoundary` markers, side panels.

Addition rather than removal:

- Toggle buttons for the four analysis surfaces get visible labels or an `aria-label`, not
  `title`-only.
- Nerd gains no summary-control or collapse-all control; its existing technical rendering remains
  unchanged.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Session | Conversation | Session |
| Assistant / AI turn | Claude | Assistant |
| Thinking | — (hidden) | Thinking |
| Tool call `Read` + args | "read `LoginForm.tsx`" | `Read` + arguments |
| Tool call `Edit` + diff | "changed 2 lines in `LoginForm.tsx`" | `Edit` + diff |
| Tool call `Bash` + command | "ran a command" (command never shown) | `Bash` + command |
| Subagent | Helper | Subagent |
| Compaction boundary | "Older messages were summarised to save space" | Compaction boundary |
| `1.2M tokens`, cache reads | — (hidden) | as today |
| Execution trace | — (hidden) | Execution trace |
| `/Users/x/code/src/LoginForm.tsx` | `LoginForm.tsx` | full path |

## 6. Files touched

- `frontend/src/renderer/components/layout/MiddlePanel.tsx` — gate the analysis surfaces
- `frontend/src/renderer/components/layout/SessionTabContent.tsx` — the Simple header
- `frontend/src/renderer/components/chat/ChatHistory/index.tsx`
- `frontend/src/renderer/components/chat/ChatHistory/ChatHistoryToolbar.tsx`
- `frontend/src/renderer/components/chat/items/ThinkingItem.tsx`
- `frontend/src/renderer/components/chat/items/LinkedToolItem.tsx`
- `frontend/src/renderer/components/chat/items/MetricsPill.tsx`
- `frontend/src/renderer/components/chat/items/ExecutionTrace.tsx`
- `frontend/src/renderer/components/chat/CompactBoundary.tsx`
- `frontend/src/renderer/components/chat/items/StepSummary.tsx` **(new)** — the collapsed
  "What Claude did" line
- `frontend/src/renderer/utils/toolRendering/toolSummaryHelpers.ts` — plain-language tool summaries

Prefer extending `toolSummaryHelpers.ts` over writing a second summary path: it already exists for
exactly this purpose.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `utils/toolRendering/toolSummaryHelpers.ts` and `utils/displaySummary.ts` and establish
   what plain-language summary already exists. Extend rather than duplicate.
2. Extend summaries for Read, Edit, Write, Bash, Grep, Glob, and Task. Simple Bash never exposes
   command text; unknown tools read "used a tool".
3. Add a pure Simple transformation before `ChatHistoryVirtualizer` receives its items. It produces
   only You, Claude, compaction separators, and one aggregate `StepSummary` per assistant turn;
   derive stable IDs once and pass that canonical transformed array unchanged through descendants.
4. Omit thinking and technical children from Simple display data. Unmount its analysis surfaces,
   `ThinkingItem`, raw linked tools, `MetricsPill`, `ExecutionTrace`, and side panels rather than
   CSS-hiding them. Preserve today's Nerd rendering.
5. `CompactBoundary` — sentence form in Simple.
6. `MiddlePanel` — the four analysis surfaces are Nerd-only; their toggles disappear in Simple
   rather than becoming no-ops.
7. Simple header in `SessionTabContent`, mirroring sprint 02's row metadata from the light session
   path and providing a Conversations back action.
8. Path shortening in Simple, full paths in Nerd. Use `utils/pathDisplay.ts` if it already covers
   this.
9. Visible labels and `aria-pressed` for Nerd analysis toggles. Do not add collapse-all behavior.

## 8. Verification / acceptance

- `bun run typecheck`
- `bun run test` — Bun-native pure tests cover Simple transformation, tool summaries, hidden-item
  handling, basename redaction, compaction separators, and virtual-list input stability.
- `bun run qa`

Manual Tauri verification, Simple mode:

- No thinking block, flame graph, heatmap, execution trace, token figure, model ID, absolute path,
  raw Bash command, or technical child item appears.
- Every assistant turn has at most one `StepSummary`; turns with technical activity show one, and
  expanding it yields plain sentences, never JSON.
- A compacted session reads as a sentence in the flow.
- Session find, scroll restoration, auto-scroll-to-bottom, and long-output keyboard scrolling still
  behave.

Manual Tauri verification, Nerd mode:

- Identical to today apart from labelled toggles.
- Search within the session, side panels, and all four analysis surfaces still work. No
  collapse-all control is added.

## 9. Accessibility

- Turns are a list; each turn has an accessible name naming the speaker.
- The step summary is a real `<button>` with `aria-expanded`, and its expanded region is
  associated with it.
- Nerd analysis-surface toggles carry `aria-pressed` and an accessible name; Simple unmounts them.
- Long output regions are keyboard-scrollable and not focus traps.
- Code blocks keep a text alternative for their language label.

## 10. Dependencies

Sprint 01 (`useUIMode()`), sprint 02 (the conversation row whose three facts this page's header
mirrors, and the cost formatter chosen there).

## 11. Risks / open questions

- **This is the highest-risk sprint in the roadmap.** It is the app's core value and its most
  complex component tree. Budget the full week for it and do not fold other work in.
- Plain-language tool summaries are a per-tool mapping. There are many tools, and the tail is
  long. Cover the common ones (`Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `Task`) and fall
  back to "used a tool" for the rest — a generic fallback is correct here, not lazy.
- Light metadata counts visible main-thread turns and excludes thinking, tool-result-only users,
  sidechains, compaction, and technical records, keeping the Simple header consistent with its
  reading surface.
- `ExecutionTrace` and the analysis surfaces may hold state that assumes they are mounted. Gating
  them must unmount cleanly, not just hide them with CSS.
