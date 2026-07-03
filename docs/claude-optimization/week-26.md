# Week 26 — Agents Manager

**Objective:** Manage `~/.claude/agents/` (audit: 22 agent `.md` files, YAML frontmatter
`name/description/tools/model`) in-app: edit frontmatter with typed controls, edit the
system-prompt body, create/delete agents. Today: hand-edit YAML and hope the frontmatter
parses.

**Prerequisites:** weeks 15, 25 (editor kit + small-text write path with allowlist —
`agents/` joins the allowlist). Existing readers:
- `internal/files/pathutil.go:340-358` — `ReadGlobalAgents` (frontmatter already parsed
  for the existing read-only agents view)
- The existing `agents` ActivityView (read-only browser this week upgrades)

## Tickets

### W26-T1 — Frontmatter-aware write path
- Extend the week-25 writer for agents: parse frontmatter + body, apply typed frontmatter
  patch (`name`, `description`, `tools` list, `model`), re-emit with the BODY byte-preserved
  and only the touched frontmatter keys reserialized; unknown frontmatter keys survive
  untouched.
- Validation before write: frontmatter must re-parse, `name` unique across the agents dir,
  `model` from the known-model list (warning, not a hard block — new models appear).
- Create: minimal template (name/description + empty body). Delete: `TrashItems`
  (user-authored — trash policy).
- Verify: `go test ./internal/files/...` — patch round-trip preserves body bytes + unknown
  keys; duplicate-name rejected; delete→restore round-trip.

### W26-T2 — Manager UI
- Upgrade the existing agents view: list (name, model chip, tools summary, file size) →
  detail editor on `<ConfigEditorShell>`: typed frontmatter controls (text inputs, tools
  multi-select from the known-tool list plus free entry, model select) + body textarea via
  `useFileBackedEditor`.
- Project-level agents (`.claude/agents/` per project, already read at
  `pathutil.go:258-272`) shown read-only with provenance chips — global-only writes this
  week (project writes need per-project allowlist plumbing; defer until asked).
- Dual gate: writes `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Frontmatter edit round-trips: body byte-identical, unknown keys preserved, file
      re-parses via `ReadGlobalAgents` (tests).
- [ ] Duplicate agent name blocked; unknown model warns but saves (tests).
- [ ] Create produces a file the existing reader lists immediately; delete lands in trash
      and restores (tests).
- [ ] A fresh Claude Code session lists an agent created in-app (manual sanity: appears in
      the Agent tool's registry).
- [ ] Project agents visible read-only with provenance; no write affordance (review gate).
- [ ] Writes dual-gated; editor hidden in browser build.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — a frontmatter emit that doesn't re-parse makes the agent
  vanish from the CLI's registry (or fails agent loading wholesale, depending on CLI
  parsing strictness). Validate-before-write plus `.bak` plus body byte-preservation keeps
  failures recoverable and rare.
- **YAML round-trip fidelity** — YAML reserialization is notoriously lossy (quoting,
  ordering, comments). Patching ONLY touched keys and never re-emitting untouched
  lines/body is the design constraint that makes this safe; a full-file YAML round-trip is
  review-rejectable.
- **Tools-list foot-gun** — granting an agent `*` or removing its guardrail tool list
  changes what it can do on the user's machine. The multi-select shows current grants
  plainly; no bulk "give all tools" affordance.
