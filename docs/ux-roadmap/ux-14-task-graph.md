# UX-14 — Task Graph

Rail visibility: **behind-More** ("How tasks connect") · Depends on: 01, 03 · See
[README.md](README.md)

## 1. Goal

Give the task graph a readable Simple form — an indented outline instead of a node graph — and label
the Nerd graph well enough that a new power user can read it.

## 2. Today

Root is `dashboard/TaskGraphViewer.tsx` (227 lines), reading `~/.claude/tasks/`, with a list labelled
`aria-label="Task graphs"` (`:72`).

Problems for a non-technical reader:

- **"Task graph" names a data structure.** It is the most nerd-facing page in the app, and it is
  named after its implementation.
- **A node-and-edge diagram assumes graph literacy.** Understanding it means knowing that nodes are
  work, edges are dependencies, and direction means order. None of that is stated.
- **Nothing says why you would look at this.** The page answers "what did Claude delegate and in what
  order" — a genuinely useful question that the page never poses.
- **Agent and task identifiers are shown raw**, so the nodes are labelled with IDs rather than with
  what the work was.

## 3. Simple view

```
+--------------------------------------------------------------+
|  How tasks connect                                           |
|                                                              |
|  When Claude splits work between helpers, this shows what     |
|  ran and in what order.                                      |
|                                                              |
|  Fixing the login bug  ·  2 hours ago                        |
|                                                              |
|   1. Find the problem                          done          |
|        - read LoginForm.tsx                    done          |
|        - searched for "submit"                  done          |
|   2. Write the fix                             done          |
|        - changed 2 lines                       done          |
|   3. Add a test                                running       |
|        - writing the test file                 running       |
|                                                              |
|  Nothing to show                                             |
|   This appears when Claude hands work to more than one        |
|   helper.                                                    |
+--------------------------------------------------------------+
```

Rules:

- **An indented outline, not a diagram.** Order top to bottom, dependency by indentation. Every
  reader can already read an outline; not every reader can read a DAG.
- One sentence saying what the page answers, above the content.
- Each row: what the work was, in plain language, and its state as a word.
- **No node IDs, no agent IDs, no edge labels.** If a node's only label is an identifier, show the
  helper's name from [ux-09](ux-09-agents.md)'s vocabulary, or "a helper" — not the ID.
- The graph selector is a plain list of task groups by task subject and time. The current task API
  has no conversation/session identity or conversation-to-task relation, so the UI must not invent a
  conversation label or link.
- Empty state explains the precondition, since an empty task graph is the *normal* case for most
  sessions and must not read as breakage.

## 4. Nerd view

Today's graph, unchanged. Additions: a legend stating what nodes and edges mean, and the outline from
Simple mode as an alternative view toggle — the outline is genuinely useful at any expertise level,
and it is also the accessible representation of the graph.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Task Graph | How tasks connect | Task Graph |
| Task graphs (the list) | Conversations with helper work | Task graphs |
| Node | Step | Node |
| Edge / dependency | indentation | Edge |
| Agent ID `a20e6d43…` | helper name, or "a helper" | agent ID |
| `pending` / `running` / `completed` | waiting / running / done | as today |
| Subagent | Helper | Subagent |

## 6. Files touched

- `frontend/src/renderer/components/dashboard/TaskGraphViewer.tsx`
- `frontend/src/renderer/components/dashboard/TaskOutline.tsx` **(new)** — the outline, used by
  Simple mode and by Nerd mode's toggle
- `frontend/src/renderer/components/dashboard/TaskOutline.test.ts` **(new)** — graph flattening and
  cycle handling tests

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read the task record shape under `frontend/src/shared/types/` and establish whether nodes carry a
   human-readable description or only IDs. This determines whether the outline can be labelled
   honestly.
2. `TaskOutline.tsx` — flatten the graph to an indented outline. A cycle must not hang the
   renderer: cap depth and mark anything unreachable rather than recursing blindly.
3. Simple view: explanatory sentence, task-group selector by task subject, the outline.
4. Branch `TaskGraphViewer.tsx` on `useUIMode()`.
5. Nerd mode: a legend, and an outline/graph toggle reusing `TaskOutline`.
6. Empty state framed as the normal case, in both modes.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`
- A unit test for the graph-to-outline flattening, including a cyclic input — it must terminate and
  mark the cycle, not overflow the stack.

Simple mode: an outline, not a diagram; no node or agent ID visible; states shown as words; the empty
state reads as normal rather than as an error.

Nerd mode: the graph matches today; the legend explains nodes and edges; the outline toggle works.

## 9. Accessibility

- **The outline is the accessible form of this page.** A node diagram is not navigable by screen
  reader; a nested list is. That is why Nerd mode gets the toggle too — it is not a courtesy, it is
  the page's accessibility story.
- The outline is a real nested list (`<ul>` inside `<li>`), so depth is conveyed structurally rather
  than by indentation pixels.
- State is text; if a colour dot accompanies it, the dot is `aria-hidden`.
- The graph view has a text alternative summarising step count and completion.

## 10. Dependencies

Sprint 01, sprint 03 (conversation subjects and the plain-language tool summaries this page's step
labels reuse), sprint 09 (helper vocabulary).

## 11. Risks / open questions

- **Nodes may only carry IDs.** If task records have no human-readable label, the outline cannot be
  written in plain language and this sprint's premise fails. Settle in task 1. The fallback is
  "Step 1", "Step 2" with the helper name where available — numbered steps are honest; invented
  descriptions are not.
- **A graph is not necessarily a tree.** Flattening a DAG to an outline duplicates any node with two
  parents. Decide the rule — show the duplicate, or show it once at its shallowest depth with a
  "also needed by" note — and record it here. Do not let it be discovered at implementation time.
- Cycles should not occur in a task graph, but a tolerant reader must survive one anyway. `~/.claude`
  formats drift, and a hung renderer is a worse failure than a marked anomaly.
- This is the page most likely to be genuinely empty for most users. Its Simple form must be
  reassuring, not apologetic.
