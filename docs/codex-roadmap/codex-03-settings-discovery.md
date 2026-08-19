# CDX-03 — Settings discovery and precedence

Rail visibility: Settings · Depends on: CDX-01, CDX-02 · See `docs/ux-roadmap/ux-07-settings.md`

## 1. Goal

Purpose: show users which Codex settings are active, where each value came from, and which lower-priority values are being shadowed. This sprint is read-only so the precedence model can be validated before an editor is introduced.

## 2. Today

The app has a Claude settings surface with source enumeration and a Simple/Nerd mode. It does not parse Codex `config.toml`, project `.codex/config.toml`, profiles, or system policy layers. The effective-value rules must be implemented in Rust and tested independently of the UI.

## 3. Simple view

```text
Codex settings

Model                 gpt-5-codex          Project
Approval mode         On request           User
Sandbox               Workspace write      User
Profile               Default              User

View sources   Open config folder
```

Rules:

- Show one effective value per setting.
- Show a short source label beside the value.
- Use “Not set” when no layer defines a value.
- Keep raw TOML behind the Nerd view.

## 4. Nerd view

Show a precedence table with one row per layer:

| Layer | Example source | State |
| --- | --- | --- |
| CLI override | command invocation | highest priority |
| Project | `.codex/config.toml` | trusted project only |
| Profile | selected profile file | profile-dependent |
| User | Codex home config | user |
| System | machine policy | read-only |
| Default | built-in value | fallback |

Each effective value must link to its winning layer and identify shadowed definitions without exposing secrets.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| Config layer | Settings source | Precedence layer |
| Effective config | Active settings | Resolved value after merge |
| Overridden | Not active | Shadowed by higher-priority source |

## 6. Files touched

- `src-tauri/src/config/` — add Codex TOML discovery and precedence evaluation.
- `src-tauri/src/commands/files.rs` or a focused config command module — expose read-only source data.
- `frontend/src/shared/types/api/` — add typed setting-source and effective-value models.
- `frontend/src/renderer/api/tauri/domain/` — add the DesktopAPI adapter.
- `frontend/src/renderer/components/SettingsView.tsx` and related settings components — add Codex source-aware rendering.
- Rust fixtures — cover project, profile, user, system, and missing layers.

## 7. Tasks (ordered)

1. Define the supported setting schema and mark each field as safe to display, redacted, or hidden.
2. Implement TOML parsing with unknown-key preservation in the read model.
3. Implement documented precedence as an ordered, inspectable merge rather than scattered fallback logic.
4. Resolve profiles only from the selected Codex configuration context.
5. Return source provenance and parse diagnostics in the command response.
6. Add the Settings source table in Simple and Nerd modes.
7. Add fixture tests for duplicate keys, invalid TOML, missing files, and shadowed values.

## 8. Verification / acceptance

- The same input files always produce the same effective settings and provenance.
- Invalid low-priority files produce a visible diagnostic without hiding valid higher-priority values.
- Secrets and token-like values never appear in the response or logs.
- Untrusted project configuration is not treated as active without the existing trust decision.
- `bun run typecheck` and targeted Rust config tests pass.

## 9. Accessibility

- Source labels must be part of the accessible name for each setting.
- The source table needs a real table structure or an equivalent labeled grid.
- Expand/collapse controls must expose state and work with keyboard input.

## 10. Dependencies

- CDX-01 root resolution.
- Existing settings source and Simple/Nerd primitives.
- A redaction policy shared with CDX-04 and CDX-08.

## 11. Risks / open questions

- TOML syntax and supported settings can change with Codex releases; unknown keys should be retained as diagnostics, not silently dropped.
- CLI-only overrides may not be recoverable from local files; label them unavailable instead of inferring them.
- System policy may be readable but not writable and should never be offered an edit action.

## 12. References

- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
