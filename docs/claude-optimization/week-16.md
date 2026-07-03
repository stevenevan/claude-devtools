# Week 16 — Hooks Manager (Toggle-Only)

**Objective:** Make `settings.json.hooks` visible and safely toggleable — the audit found 6
wired entries (rtk PreToolUse, caveman/ponytail SessionStart + UserPromptSubmit) editable
only by hand-editing nested JSON arrays. Hooks execute arbitrary shell commands on CLI
events: this week ships **enable/disable toggles only**, never free-text command editing.

**Prerequisites:** week 15 (`MutateSettingsJSON`, `useFileBackedEditor`,
`<ConfigEditorShell>`). The existing settings editor (`internal/files/settings_write.go`)
deliberately kept hooks read-only; this week is the guarded upgrade.

## Tickets

### W16-T1 — Typed hooks patch in Go
- Parse `settings.json.hooks` into a typed model (event → matchers → command entries).
  Toggle = moving an entry between the live `hooks` key and a parallel
  `hooksDisabled` key (app-owned convention, ignored by the CLI) — command strings are
  carried **verbatim, byte-for-byte**; the app never reconstructs, escapes, re-quotes, or
  otherwise touches a command string.
- All writes through `MutateSettingsJSON` (settings_write pattern; single mutex). Unknown
  hook-shape fields preserved untouched (map-level moves, not struct round-trips).
- Never auto-enable anything: enabling is always an explicit user action per entry.
- Verify: `go test ./internal/files/...` — toggle round-trip preserves command bytes and
  unknown fields; disabled entries invisible to a simulated CLI read of `hooks`.

### W16-T2 — Hooks panel
- Settings tab section (extends the existing settings surface, `electronOnly: true`) built
  on `<ConfigEditorShell>`: one row per hook entry — event, matcher, **full command string
  always visible** (monospace, never truncated behind an ellipsis without expand), enabled
  toggle.
- Arming (enable) confirm dialog repeats the full command: "This command will execute on
  every &lt;event&gt;: `<command>` — enable?".
- Free-text editing, adding new hooks, and matcher editing are explicitly OUT (command-
  injection surface; authoring stays in a text editor for now) — panel says so.
- Dual gate: toggles `electronOnly: true` AND `connectionMode === 'local'`.
- Verify: `bunx tsc --noEmit` + `bun run test` green.

## Exit criteria

- [ ] Toggle off → entry absent from `hooks`, preserved under `hooksDisabled`; CLI ignores
      it (fresh `claude` session: hook does not fire — manual sanity); toggle on restores it
      byte-identical (test).
- [ ] Unknown keys at every level survive a toggle round-trip (test — settings_write
      pattern's preserve-unknown property).
- [ ] Full command string visible for every entry; arming dialog shows it verbatim.
- [ ] No code path auto-enables a hook (review gate + test: fresh parse never mutates).
- [ ] No UI affordance edits command text (review gate).
- [ ] Toggles dual-gated; tab `electronOnly: true`.
- [ ] `go test ./internal/files/...`, `bunx tsc --noEmit`, `bun run test` green.

## Risks

- **Breaks the CLI itself** — a malformed `hooks` write can block every CLI launch (hooks
  parse at startup), and disabling the wrong hook silently changes CLI behavior the user
  relies on (rtk token-saving rewrites, mode activation). `MutateSettingsJSON` atomicity +
  `.bak` + verbatim preservation bound the damage; the toggle model (move, don't delete)
  makes every change reversible in one click.
- **This UI arms command execution** — enabling a hook is consenting to run its command on
  every matched event. The always-visible command string and the arming dialog exist so
  consent is informed; any future "edit command" feature needs its own security review, not
  a quiet diff.
- **`hooksDisabled` convention drift** — a CLI update could claim that key. Namespacing
  check at load (warn if the key holds non-app-shaped data) and the convention documented in
  the code header.
