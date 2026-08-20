# CDX-04 — Safe Codex settings editor

Rail visibility: Settings · Depends on: CDX-03 · See `docs/ux-roadmap/ux-07-settings.md`, `docs/ux-roadmap/ux-15-maintenance.md`

## 1. Goal

Purpose: let users change a small, explicitly supported set of Codex settings with a reviewable diff, an atomic write, and a recovery path. The editor must protect unknown TOML and never turn a settings form into an arbitrary file writer.

## 2. Today

Settings commands and maintenance write paths already exist for Claude. Codex settings discovery is planned in CDX-03, but Codex has no typed patch contract, TOML-preserving writer, backup step, or confirmation flow in this app.

## 3. Simple view

```text
Codex settings

Model              [ gpt-5-codex       v ]
Approval mode      [ On request        v ]
Sandbox            [ Workspace write   v ]

Review changes                 Save
```

The review step must show the exact file, setting, old value, and new value before Save is enabled. Unsupported fields remain read-only.

## 4. Nerd view

```text
Change preview
~/.codex/config.toml

  model = "gpt-5"
  model = "gpt-5-codex"

[x] Create recovery copy
[x] Re-read after write
                         Cancel   Apply
```

The server re-reads the target, checks its expected revision, applies a typed patch, writes atomically, and re-reads the result. A conflict stops the write and asks the user to refresh.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| Patch | Change | Typed config patch |
| Save config | Apply changes | Atomic write with revision check |
| Backup | Recovery copy | Pre-write snapshot |

## 6. Files touched

- `src-tauri/src/config/` — add typed Codex patching and document-preserving TOML write support.
- `src-tauri/src/commands/` — add a narrowly scoped update command with boundary validation.
- `src-tauri/src/files/` — reuse or extend safe backup, atomic write, and trash helpers.
- `frontend/src/shared/types/api/` — add patch, diff, conflict, and write-result types.
- `frontend/src/renderer/components/SettingsView.tsx` — add forms, diff review, and conflict states.
- Rust and frontend tests — cover patches, redaction, cancellation, and concurrent changes.

## 7. Tasks (ordered)

1. Choose the first supported fields: model, approval mode, sandbox policy, profile selection, and safe feature flags.
2. Reject unknown keys, path-like values, token fields, and writes to system policy in the command boundary.
3. Implement a document-preserving patcher that keeps comments and unrelated keys where possible.
4. Create a recovery copy before writing and keep it within the approved app-data or Codex safety boundary.
5. Write through a temporary file and rename only after validation succeeds.
6. Return a redacted diff and post-write verification result.
7. Add the review modal and clear conflict/recovery actions.

## 8. Verification / acceptance

- Cancel leaves every source file byte-for-byte unchanged.
- Save cannot target a path supplied directly by the renderer.
- A concurrent modification is detected and does not get overwritten.
- Invalid values are rejected before a backup or write is attempted.
- A failed write reports the target and recovery action without leaking content.
- `bun run qa` passes after the command and UI are implemented.

## 9. Accessibility

- Every form control has a visible label and an accessible error message.
- The review dialog traps focus, restores focus on close, and exposes the changed setting names.
- Destructive or irreversible wording must not be hidden in a tooltip.

## 10. Dependencies

- CDX-03’s typed effective-settings and provenance model.
- Existing native save/recovery and root-relative safety helpers.
- A confirmed policy for whether writes are local-only while a remote session is selected.

## 11. Risks / open questions

- TOML formatting libraries may rewrite comments or ordering; test the chosen writer against real files before shipping.
- Recovery copies are only useful if their location and restore behavior are clear; do not imply a backup exists unless it was successfully created.
- Settings that alter execution safety need stronger confirmation copy and possibly an app restart notice.

## 12. References

- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
