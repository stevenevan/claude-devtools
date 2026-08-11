# UX-12.6 — form semantics and interaction primitives

Rail visibility: **cross-cutting** · Cadence: **one sprint-week** · Depends on: UX-12.5 · See
[README.md](README.md)

## 1. Goal

Add the next three Base UI-backed shadcn primitives that have a direct match in this app:
`Field`, `Combobox`, and `Progress`. Use them to finish the highest-value form and interaction
gaps left by UX-12.5 without introducing a new palette, font, dependency, or visual system.

## 2. Today

UX-12.5 added the shared checkbox, radio-group, dropdown-menu, and label wrappers. The remaining
gaps are narrower:

- Settings and maintenance forms still repeat label, helper-text, and error markup around raw
  inputs, textareas, and selects.
- Repository and project selectors expose long lists without typeahead or search. The current
  `RepositoryDropdown` is a menu, not a combobox.
- `chat/ReplayControls.tsx` hand-builds a progressbar and also keeps local button/radio markup
  alongside the replay state.
- Dense native selects in `MemoryPanel.tsx` and `SettingsDiffPanel.tsx` were explicitly deferred
  by UX-12.5; this sprint decides per control whether `NativeSelect` or `Combobox` is the right
  contract.

## 3. One-week outcome

- Add `field.tsx`, `combobox.tsx`, and `progress.tsx` under
  `frontend/src/renderer/components/ui/`, using the installed `@base-ui/react` version.
- Use `Field`, `FieldLabel`, `FieldDescription`, and `FieldError` in the named settings and
  maintenance forms so labels, help text, invalid state, and async errors share one contract.
- Use `Combobox` for repository/project choices that benefit from search; retain `NativeSelect`
  for short dense lists and diff/source choices.
- Use `Progress` for replay progress while preserving the existing replay buttons, speed choices,
  live announcement, zero-chunk behavior, and state updates.
- Keep Simple and Nerd wording, layout, persistence, and existing custom editor interactions.

## 4. Base UI contract

- Run shadcn CLI from `frontend/components.json` and review every generated file before wiring it.
- Generated wrappers must import `@base-ui/react/*`, use `@renderer/lib/utils`, and stay under
  `frontend/src/renderer/components/ui/`.
- Use `lucide-react` for icons. Do not add Radix, another icon library, a form library, or a new
  styling dependency.
- Confirm the generated APIs against the installed `@base-ui/react` version before migrating
  callers. Adapt the wrapper locally if the registry output does not typecheck.

## 5. Migration boundaries

`Field` is a semantics and layout wrapper, not a reason to rewrite every custom editor. Migrate
the named form surfaces below; leave code editors, virtualized rows, custom color pickers, and
domain-specific keyboard interactions intact unless the field wrapper preserves them exactly.

`Combobox` is only for choices where search or typeahead improves selection. Do not replace every
short `NativeSelect`, especially the two-option and diff/source selectors.

`Progress` is for the replay status track. Do not turn the track into a seek control in this sprint;
replay navigation remains owned by the existing step buttons and keyboard shortcuts.

## 6. Files touched

New wrappers:

- `frontend/src/renderer/components/ui/field.tsx` **(new)**
- `frontend/src/renderer/components/ui/combobox.tsx` **(new)**
- `frontend/src/renderer/components/ui/progress.tsx` **(new)**

Field migration:

- `frontend/src/renderer/components/settings/NotificationTriggerSettings/components/GeneralInfoSection.tsx`
- `frontend/src/renderer/components/settings/NotificationTriggerSettings/components/IgnorePatternsSection.tsx`
- `frontend/src/renderer/components/settings/NotificationTriggerSettings/components/DynamicConfigSection.tsx`
- `frontend/src/renderer/components/settings/NotificationTriggerSettings/components/TriggerConfiguration.tsx`
- `frontend/src/renderer/components/settings/NotificationTriggerSettings/components/ColorPaletteSelector.tsx`
- `frontend/src/renderer/components/settings/sections/ConnectionSection/SshConnectionForm.tsx`
- `frontend/src/renderer/components/settings/sections/WorkspaceSection.tsx`
- `frontend/src/renderer/components/settings/sections/ThemeEditor.tsx`
- `frontend/src/renderer/components/settings/sections/WebhookSettings.tsx`
- `frontend/src/renderer/components/settings/sections/BackendDebugPanel.tsx`
- `frontend/src/renderer/components/settings/sections/ClaudeCodeSection.tsx`
- `frontend/src/renderer/components/dashboard/AgentsManager.tsx`
- `frontend/src/renderer/components/dashboard/CostSummary.tsx`
- `frontend/src/renderer/components/maintenance/ClaudeJsonPurgeSection.tsx`
- `frontend/src/renderer/components/maintenance/HistoryPanel.tsx`
- `frontend/src/renderer/components/maintenance/MemoryPanel.tsx`
- `frontend/src/renderer/components/maintenance/SettingsDiffPanel.tsx`

Combobox and progress migration:

- `frontend/src/renderer/components/common/RepositoryDropdown.tsx`
- `frontend/src/renderer/components/maintenance/PermissionsPanel.tsx`
- `frontend/src/renderer/components/maintenance/ProjectSettingsPanel.tsx`
- `frontend/src/renderer/components/chat/ReplayControls.tsx`

Keep out of scope unless a direct interaction-preserving migration is proven:

- `chat/AnnotationEditor.tsx`, `dashboard/SkillDetail.tsx`,
  `maintenance/InstructionFileEditor.tsx`, and `maintenance/MemoryFileEditor.tsx` as custom text
  editors.
- Virtualized chat/session rows, drag handles, code/diff viewers, custom color swatches, and native
  controls inside platform-specific or domain-specific interactions.

## 7. Tasks (ordered)

0. Load the `impeccable` skill and read the current UI wrappers, the Base UI component docs, and
   every named caller before editing.
1. Re-inventory the remaining raw controls and record each target's current label, description,
   validation, disabled, loading, keyboard, and persistence behavior.
2. Generate only `field`, `combobox`, and `progress` from the existing Base UI configuration. Review
   imports, focus behavior, portal behavior, controlled-value APIs, and class merging.
3. Migrate form fields in the named settings and maintenance surfaces. Preserve existing state
   handlers, error messages, secret masking, async save behavior, and native-select behavior where
   it is intentionally denser or shorter.
4. Replace the repository/project selectors selected by the inventory with `Combobox`. Verify
   filtering, empty state, disabled state, selection, Escape, and focus return.
5. Replace the replay progressbar with `Progress` and migrate only the replay controls that have a
   direct existing wrapper. Preserve replay timing and all existing keyboard shortcuts.
6. Run the source audit again, document remaining exceptions, run the UI detector, and complete
   keyboard/focus smoke checks in Simple and Nerd modes.

## 8. Verification / acceptance

- `bunx shadcn@latest add field combobox progress` from `frontend/`
- `bun run typecheck`
- `bun run test`
- `bun run qa`
- `node /Users/stevenevan/.agents/skills/impeccable/scripts/detect.mjs --json` over every changed
  UI file
- Source audit confirms no new icon dependency, no `@radix-ui/*` imports, and no raw controls in
  the named Field/Combobox/Progress surfaces except documented custom-editor exceptions.

Manual acceptance:

- Field labels, descriptions, and errors remain associated with controls; invalid and disabled
  states are visible and announced.
- Repository/project comboboxes support typing, filtered results, empty results, arrow navigation,
  Enter selection, Escape close, and focus return.
- Replay progress exposes the same percentage and live status, including `totalChunks === 0`,
  without changing play, pause, step, stop, or speed behavior.
- Simple and Nerd settings retain existing wording, density, and saved values.

## 9. Accessibility

- Use `FieldLabel`, `FieldDescription`, and `FieldError` rather than manually recreating their
  associations.
- Comboboxes expose an accessible label, current value, listbox state, and keyboard navigation.
- Progress exposes bounded values and never uses color as its only meaning.
- Preserve visible focus, disabled semantics, live replay announcements, and error adjacency.

## 10. Dependencies

UX-12.5, the existing Base UI-backed shadcn layer, `@base-ui/react`, `lucide-react`, and the
existing store/API contracts.

## 11. Risks / open questions

- The registry's Field and Combobox wrappers may assume newer Base UI props than the installed
  version. Adapt the wrapper without adding a compatibility dependency.
- Searchable selectors can change identity matching when repository names collide. Keep IDs and
  paths as the selection values; display labels may remain human-readable.
- Field spacing can alter dense maintenance layouts. Preserve local density with explicit className
  overrides instead of changing global tokens.
- Replay progress must remain read-only. Adding a slider or click-to-seek interaction is a separate
  sprint because it changes replay state ownership and keyboard behavior.

## 12. Shipped status

UX-12.6 shipped as the cross-cutting prerequisite for the grouped UX-13–15 delivery. The Field,
Combobox, and Progress wrappers and their migrations are present; the roadmap remains page-frozen.
