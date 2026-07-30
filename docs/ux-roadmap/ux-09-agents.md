# UX-09 — Agents

Rail visibility: **behind-More** ("Claude's helpers") · Depends on: 01, 08 · See
[README.md](README.md)

## 1. Goal

Present agents as named helpers with a job description, and make the editor forgiving enough that a
non-technical user can read one without breaking it.

## 2. Today

Root is `dashboard/AgentsManager.tsx` (273 lines) with `dashboard/AgentDetailEditor.tsx`. The
create form uses `placeholder="my-agent"` (`AgentsManager.tsx:171`) and
`placeholder="What this agent does"` (`:181`).

Problems for a non-technical reader:

- **"Agent" is unexplained.** The relationship between an agent, a skill and a plugin is invisible,
  and all three pages look alike.
- **`placeholder="my-agent"` teaches a naming convention by example.** A user does not learn from it
  that the name must be a slug, only that theirs should look like that one.
- **The detail view is an editor.** `AgentDetailEditor` exposes the agent's definition — model,
  tools, system prompt — as editable fields. A user browsing to see what an agent does is one
  keystroke from changing it.
- **Tool lists are tool names.** `Read, Write, Edit, Bash, Glob, Grep` is precise and opaque.
- **Model IDs are shown raw**, which [README.md](README.md) §7 puts on the always-hidden list.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Claude's helpers                                            |
|                                                              |
|  Helpers are specialists Claude can hand work to — one for    |
|  reviewing code, one for writing tests, and so on.           |
|                                                              |
|  +--------------------------------------------------------+  |
|  |  Code reviewer                                          |  |
|  |  Looks over code and points out problems                |  |
|  |  Can read your files                                    |  |
|  +--------------------------------------------------------+  |
|  |  Test writer                                            |  |
|  |  Writes tests for code you already have                 |  |
|  |  Can read and change your files                         |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  (read-only — [ Edit helpers ] switches to detailed view)    |
+--------------------------------------------------------------+
```

Rules:

- **One sentence explaining helpers**, and it names the relationship to skills so the two pages stop
  looking interchangeable.
- Each row: name, what it does, and **what it is allowed to touch** in plain language. That last
  line is the one thing a cautious non-technical user actually wants to know.
- **Read-only in Simple mode.** No create, no edit, no delete. Editing an agent means editing a
  system prompt, and there is no forgiving version of that.
- "Edit helpers" switches to the detailed view for this visit, the same escape hatch pattern as
  [ux-07](ux-07-settings.md) §3.
- No model IDs, no raw tool names, no file paths.

## 4. Nerd view

Today's page and editor, unchanged: create form, `AgentDetailEditor` with model, tools and system
prompt, delete.

Additions: the create form's name field states its rule ("lowercase, dashes instead of spaces")
rather than only demonstrating it in a placeholder, and validation errors say what to fix.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Agents | Claude's helpers | Agents |
| Agent | Helper | Agent |
| Subagent | Helper | Subagent |
| `Read, Write, Edit, Bash` | "Can read and change your files" | tool list, as today |
| `Read, Glob, Grep` | "Can read your files" | tool list, as today |
| `Bash` present | "Can run commands on your computer" | tool list, as today |
| Model: `claude-opus-5` | — (hidden) | Model: `claude-opus-5` |
| System prompt | — (hidden) | System prompt |

The tool-list-to-sentence mapping is the interesting part of this sprint. Keep it coarse and
truthful: read-only, read-and-change, and runs-commands. Do not enumerate.

## 6. Files touched

- `frontend/src/renderer/components/dashboard/AgentsManager.tsx`
- `frontend/src/renderer/components/dashboard/AgentDetailEditor.tsx`
- `frontend/src/renderer/components/dashboard/InstallableList.tsx` — reused from
  [ux-08](ux-08-skills.md)
- `frontend/src/renderer/components/dashboard/agentCapability.ts` **(new)** — the tool-list →
  sentence mapping

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. `agentCapability.ts` — map a tool list to one of three capability sentences. Pure function, with
   a small test: `['Read','Grep']` → read-only, `['Read','Edit']` → read-and-change, anything
   containing `Bash` → runs-commands. `*` counts as runs-commands.
2. Simple view using `InstallableList` plus the capability line. Read-only.
3. Branch `AgentsManager.tsx` on `useUIMode()`.
4. "Edit helpers" escape hatch — view state only, never writes `uiMode`.
5. Nerd mode: state the name rule in the create form; make validation messages actionable.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`
- `bun run test -- agentCapability` — the three mappings plus the `*` case.

Simple mode: an explanatory sentence names the relationship to skills; every row shows a capability
sentence; there is no create, edit or delete control; no model ID or raw tool name appears.

Nerd mode: matches today, plus a stated name rule and actionable validation errors.

## 9. Accessibility

- The capability line is text, not an icon — "can run commands" must not be a lock glyph.
- Rows are a list; each is one tab stop with an accessible name combining name and capability.
- In Nerd mode the create form's name rule is programmatically associated with the field
  (`aria-describedby`), not merely nearby.

## 10. Dependencies

Sprint 01, and sprint 08 for `InstallableList`.

## 11. Risks / open questions

- **The capability sentence is a security-adjacent claim.** "Can read your files" is a promise about
  what an agent may do. If `AgentDetailEditor`'s tool list is not the authoritative permission set —
  if permissions can also come from settings or a plugin — then the sentence is wrong in a way that
  matters. Confirm the tool list is authoritative before shipping the mapping; if it is not, show
  the raw list in both modes rather than a comforting sentence.
- Read-only Simple mode means a non-technical user cannot create a helper. That is deliberate, and
  it is a real limitation — record it here rather than softening it later with a half-editor.
- Agents may have no description. Fall back to the capability line alone; do not synthesise a
  description from the system prompt.
