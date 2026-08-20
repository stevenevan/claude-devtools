# CDX-10 — App integration, hardening, and release

Rail visibility: source switch · Depends on: CDX-01 through CDX-09 · See `docs/ux-roadmap/README.md`, `docs/ux-roadmap/ux-01-navigation.md`

## 1. Goal

Purpose: connect every Codex surface to the app shell, then prove the complete integration is safe, predictable, accessible, and maintainable before release. This is the final source-switch, regression, and rollout week.

## 2. Today

The app has the shell, ActivityBar, routes, Zustand stores, Tauri command registry, Rust safety checks, frontend tests, QA commands, and maintenance write paths. Codex adds roots, sessions, transcripts, task graphs, settings, agents, skills, plugins, MCP, usage, telemetry, file history, and shell snapshots. The release gate must test every surface and existing Claude behavior together.

## 3. Simple view

```text
Source                         [Codex v]

History   Transcripts   Tasks
Settings  Agents       Skills
Plugins  MCP           Maintenance

Codex ready · 12 sessions · 30 days usage
```

Rules:

- Source selection is visible and persists across the current session.
- Claude and Codex cache keys, projects, sessions, and maintenance targets remain isolated.
- User-facing failures must name the broken operation, identify whether data changed, and provide the safest next action.
- A Codex-only or unavailable feature explains its state instead of showing a broken Claude fallback.

## 4. Nerd view

The release candidate must present the same source and safety context in every Codex surface:

| Area | Pass condition |
| --- | --- |
| Root | only approved roots are read or written |
| Sessions | History, transcripts, and task graphs use isolated source-aware caches |
| Parsing | malformed records are isolated and reported |
| Settings | precedence, review, recovery, and conflicts are visible |
| Agents/skills/plugins | source, ownership, enabled state, and invalid files are visible |
| MCP/policy | redaction and configured/enabled/observed states are distinct |
| Usage/telemetry | metrics are sourced, bounded, and redacted |
| Maintenance | file history and shell snapshots obey local-only safety rules |
| Redaction | secrets never cross the API boundary |
| Writes | review, recovery, atomicity, and conflict checks pass |
| Source switch | Claude and Codex caches remain isolated |
| UI | Simple/Nerd, keyboard, and responsive states pass |
| Upgrade | unknown fields and future versions degrade safely |

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| Provider | Source | Source context |
| QA gate | Release checklist | Automated acceptance matrix |
| Error | Could not complete this action | Operation failed before/after write |
| Rollback | Restore recovery copy | Revert to verified pre-write snapshot |

## 6. Files touched

- `src-tauri/src/main.rs`, `src-tauri/src/commands/`, and `frontend/src/shared/types/api/` — finalize source-aware command and API contracts.
- `frontend/src/renderer/` — add source selection, route guards, loading states, capability states, and isolated store/cache keys.
- `src-tauri/tests/` and parity fixtures — add the full Codex fixture matrix.
- `frontend/src/` tests — cover source switching, sessions, usage, maintenance, redaction, and focus behavior.
- `scripts/qa-rust-grep-gate.sh` — extend safety assertions only when required by new paths.
- `docs/codex-roadmap/` — record acceptance evidence and unresolved release questions.
- `docs/ux-roadmap/README.md` — add a cross-link only after the Codex plan is accepted or shipped.

## 7. Tasks (ordered)

1. Add the source selector and thread `Claude | Codex` through route loaders, stores, command calls, and cache keys.
2. Add capability-aware route states for History, Transcripts, Task Graph, Settings, Agents, Skills, Plugins, MCP, Usage, Telemetry, File History, and Shell Snapshots.
3. Build fixtures for missing roots, malformed TOML/JSONL, incomplete graphs, path traversal, symlinks, untrusted projects, and concurrent writes.
4. Add redaction tests for settings, telemetry, shell snapshots, errors, logs, plugin metadata, and MCP configuration.
5. Run the complete frontend, Rust, typecheck, and QA suites with Claude fixtures unchanged.
6. Perform a manual smoke pass across every Codex route, including usage summaries, telemetry states, file-history recovery, and shell-snapshot read-only behavior.
7. Verify keyboard navigation, screen-reader labels, reduced motion, narrow windows, and long content.
8. Measure scan time and memory on a large local history; add bounded pagination or a documented limit if needed.
9. Document rollout, recovery, known limitations, and the exact command/build used for release.

## 8. Verification / acceptance

- `bun run qa` passes from a clean checkout with Codex fixtures enabled.
- Every listed Codex surface has a loading, empty, unavailable, malformed, and permission-denied state where applicable.
- A failure in any Codex parser or writer reports what broke and leaves the source unchanged unless the write was verified.
- The safety grep gate covers every new root, write, delete, restore, telemetry, and snapshot path.
- No test or manual check requires real credentials, a live MCP server, or shell execution.
- Existing Claude sessions, settings, maintenance, usage, and restore tests remain green.
- Release is blocked until the restore behavior and native save dialog assumptions called out in the project instructions are manually confirmed.

## 9. Accessibility

- Run the app with keyboard-only navigation and a screen reader before release.
- Verify focus order in source switching, History, transcripts, graphs, settings forms, maintenance tables, dialogs, cards, and code/text viewers.
- Check contrast, zoom to 200%, reduced motion, graph alternatives, and error announcements.

## 10. Dependencies

- All previous Codex sprint contracts and fixtures.
- Existing route, store, navigation, API, maintenance, and `bun run qa` gates.
- A release owner for manual confirmation of local-only writes and recovery behavior.

## 11. Risks / open questions

- The highest-risk area is accidental overwrite or cross-source writes; release criteria must treat uncertainty as a failed check.
- Codex CLI upgrades can change config, event, manifest, and telemetry schemas; record version assumptions and preserve unknown data.
- Large real-world logs, transcripts, task graphs, and telemetry may expose performance issues not visible in small fixtures.

## 12. References

- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
- [AGENTS.md configuration](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Build skills for Codex](https://learn.chatgpt.com/docs/build-skills)
- [Build Codex plugins](https://learn.chatgpt.com/docs/build-plugins)
- [Extend Codex with MCP](https://learn.chatgpt.com/docs/extend/mcp)

## 13. Implementation evidence — grouped sprint

The first grouped sprint is implemented on branch
`codex/grouped-codex-10-hardening-release` as five reviewable commits:

| Commit | Scope |
| --- | --- |
| `b0eb644` | Persist source identity across inventory routes and isolate source-scoped state. |
| `3d83a45` | Redact known secret formats at the Rust-to-renderer boundary and add fixture coverage. |
| `9bed245` | Verify recovery copies and post-write bytes; keep Codex checkpoint writes fail-closed. |
| `26819c6` | Replace the live-root maintenance benchmark with deterministic fixture operations and thresholds. |
| Change 5 | Add the local release gate and evidence runbook in `docs/release.md`. |

The release boundary is explicit. History, transcripts, task graphs, settings,
instructions, agents, skills, read-only plugin/MCP inventory, and safe shell
snapshot reads have source-aware contracts. Codex usage, telemetry, file-history
projection, checkpoint content/origin, and checkpoint Save as/Restore remain
unavailable until their producer and origin contracts are pinned. Claude
checkpoint writes retain the server-resolved origin, private recovery copy,
atomic conditional write, checksum/conflict checks, and post-write verification.

The deterministic benchmark is run with:

```bash
cargo run --release --bin codex-maintenance-bench --manifest-path src-tauri/Cargo.toml -- \
  --codex-root src-tauri/tests/fixtures/codex \
  --app-data-root src-tauri/tests/fixtures/codex-maintenance \
  --expected-manifest src-tauri/tests/fixtures/codex/benchmark-manifest.json
```

The fixture manifest pins format `codex-benchmark-v1`, CLI assumption `0.147.0`,
cardinalities, and unsupported diagnostics. Each operation reports p50, p95,
p99, failures, and peak RSS; the gate limits p95 to 500 ms, p99 to 1,000 ms,
and peak RSS to 64 MiB.

Focused frontend checks pass 8/8, the standalone redaction test passes 5/5,
changed Rust files pass formatting, and `git diff --check` passes. Full
`bun run qa` is not cleared in this environment because six existing
secret-related files are policy-denied. Cargo verification is also blocked by
the unavailable dependency cache/network resolution, and `graphify update .`
cannot rebuild through the same filesystem policy. These are recorded in
[`docs/release.md`](../release.md) rather than treated as passing checks.

Release remains blocked until the manual macOS table in
[`docs/release.md`](../release.md) confirms native Save as behavior, trusted
Claude restore and recovery-copy behavior, Codex pre-write rejection, source
switching, accessibility, and local-machine behavior while an SSH session is
selected.
