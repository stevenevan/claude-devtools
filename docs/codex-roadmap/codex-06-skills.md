# CDX-06 — Codex skills

Rail visibility: More · Depends on: CDX-05 · See `docs/ux-roadmap/ux-08-skills.md`

## 1. Goal

Purpose: provide a clear inventory of Codex skills, their purpose, their source, and whether they are enabled. The app should explain a skill’s instructions and bundled resources without executing its scripts or silently changing Codex configuration.

## 2. Today

The app has a reusable installable-list pattern and a Skills manager for the current integration. Codex skills are directories centered on `SKILL.md`, with optional scripts, references, and assets, and may be bundled by plugins or disabled through configuration.

## 3. Simple view

```text
Codex skills

[Browser control]       Inspect and test web pages
                        Installed · enabled

[Research]              Gather sources and write findings
                        Installed · disabled

Search skills…                           View details
```

Rules:

- Every card answers “What is this for?” in one sentence.
- Show installed, enabled, disabled, and invalid states as text.
- Keep scripts and raw files behind the detail view.

## 4. Nerd view

The detail view shows:

| Field | Example |
| --- | --- |
| Name | `browser-control` |
| Source | user / project / plugin |
| Entry point | `SKILL.md` |
| Resources | scripts, references, assets |
| Config | enabled / disabled / inherited |
| Validation | valid / missing / malformed |

The inventory is metadata-only. Listing a script must not run it, import it, or resolve commands from it.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| Skill package | Skill | Skill directory and resources |
| `SKILL.md` | Instructions | Skill entry point |
| Disabled | Turned off | Disabled by configuration |

## 6. Files touched

- `src-tauri/src/config/` — discover Codex skill configuration and sources.
- `src-tauri/src/commands/maintenance/` — add read-only skill inventory and detail commands.
- `frontend/src/shared/types/api/` — add Codex skill metadata and validation types.
- `frontend/src/renderer/components/SkillsManager.tsx` and `InstallableList.tsx` — add Codex source and state display.
- Fixtures — cover standalone, project, and plugin-bundled skills.

## 7. Tasks (ordered)

1. Define the skill inventory contract and a safe resource classification.
2. Discover standalone and plugin-provided skill directories through the server-side root resolver.
3. Parse front matter or metadata only as supported; treat malformed metadata as a visible validation state.
4. Read bounded `SKILL.md` content on demand and return resource names without executing them.
5. Surface the configured enabled/disabled state and its source.
6. Reuse the existing installable-list layout with Codex labels and source filters.
7. Defer install, update, and script execution to a separate, explicitly authorized workflow.

## 8. Verification / acceptance

- A skill with a missing `SKILL.md` appears as invalid with a useful message.
- A skill’s scripts are never launched by inventory, preview, or search commands.
- Duplicate names from different sources remain distinguishable.
- Large instruction files are bounded and report truncation.
- Claude skill behavior and existing list tests remain unchanged.

## 9. Accessibility

- Skill cards expose purpose, source, and state without color-only indicators.
- Search results announce result count and no-result states.
- Detail views use a logical heading order and preserve focus when switching skills.

## 10. Dependencies

- CDX-01 root safety.
- CDX-05 instruction and source-provenance types.
- Existing `InstallableList` and Skills manager primitives.

## 11. Risks / open questions

- A skill can contain instructions that ask an agent to run unsafe commands; the inspector must treat all displayed content as untrusted.
- Plugin-bundled skills need stable ownership metadata so deleting or disabling one is not implied by a read-only view.
- The exact enabled-state source may vary by Codex version; preserve “unknown” rather than defaulting to enabled.

## 12. References

- [Build skills for Codex](https://learn.chatgpt.com/docs/build-skills)
