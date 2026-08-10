# UX-12.5 — shadcn UI parity

Rail visibility: **cross-cutting** · Cadence: **one sprint-week** · Depends on: UX-01–12 · See
[README.md](README.md)

## 1. Goal

Finish the missing shadcn/ui primitives this app actually needs, then replace equivalent raw or
locally assembled controls with those primitives. The implementation source of truth is the
project's existing Base UI-backed shadcn layer; this is a consistency and accessibility sprint,
not a visual redesign.

## 2. Today

The repo has nineteen files under `frontend/src/renderer/components/ui/`. Interactive wrappers such
as Button, AlertDialog, Collapsible, ContextMenu, Dialog, HoverCard, Input, Popover, Select,
Separator, Switch, Tabs, and Tooltip import `@base-ui/react` directly. `frontend/components.json` already
points at the `base-mira` style and the renderer aliases.

The gap is below that layer:

- Checkbox and radio controls are still implemented as native inputs or buttons with `role="radio"`.
- `MoreMenu` and `RepositoryDropdown` assemble menu behavior from Popover plus manually labelled
  buttons instead of a menu/combobox primitive.
- Search fields, editors, and some filters still render raw `input`, `textarea`, and `select`
  elements even when the existing Input, Textarea, Select, or NativeSelect wrapper is appropriate.
- `CopyButton` has a bare overlay button, and several form surfaces have locally styled action
  buttons.
- The `iconLibrary` value in `frontend/components.json` is stale (`remixicon`); the installed and used icon
  library is `lucide-react`. This sprint must not introduce a second icon library.

## 3. One-week outcome

Simple and Nerd keep their current wording, layout, and behavior. They gain one control vocabulary
and one keyboard contract through shared shadcn wrappers.

The first migration slice is:

- Add the smallest registry set proven by the inventory: `checkbox`, `radio-group`,
  `dropdown-menu`, and `field`/`label` only where a real form field migration needs them.
- Replace the custom menu assembly in `layout/MoreMenu.tsx` with `DropdownMenu`.
- Replace the duplicated interface-mode radio buttons in `settings/SimpleSettings.tsx` and
  `settings/sections/GeneralSection/index.tsx` with `RadioGroup`.
- Replace native checkbox instances in the scoped settings, dashboard, and maintenance forms with
  `Checkbox`, preserving their controlled values, disabled states, labels, and persistence.
- Replace raw text controls in `layout/GlobalContentView.tsx`, `dashboard/HistoryBrowser.tsx`,
  `dashboard/DashboardView/CommandSearch.tsx`, and the migrated form files with the existing
  `Input`/`Textarea` wrappers.
- Replace raw action buttons in `common/CopyButton.tsx` and migrated menu/form surfaces with the
  existing Base UI-backed `Button`.
- Use `Select` or `NativeSelect` for raw selects according to the existing behavior. Do not add a
  second select implementation.

## 4. Base UI contract

- Run shadcn CLI from `frontend/components.json`; do not scaffold a separate
  component library or copy Radix examples into the app.
- Generated wrappers must import `@base-ui/react/*` and live under
  `frontend/src/renderer/components/ui/`.
- `@radix-ui/*`, a second icon library, new palette tokens, and new font dependencies are out of
  scope.
- Keep imports through `@renderer/components/ui/*` and preserve the existing `base-mira` tokens.
- Review every generated diff. A registry component is accepted only when its API and focus/close
  behavior match the current Base UI version already installed in `frontend/package.json`.

## 5. Migration boundaries

Migrate primitive controls, not domain interactions. Preserve custom chat rows, drag handles,
virtualizer rows, minimaps, code viewers, diff navigation, and window controls when no equivalent
shadcn primitive exists or when replacing them would change their interaction contract.

Do not bulk-import every component in the shadcn registry. Do not rewrite CSS or alter Simple/Nerd
information hierarchy. Any remaining raw control in the audited surfaces needs a documented reason
and a follow-up issue, not a silent exception.

This slice leaves the dense native selects in `maintenance/MemoryPanel.tsx` and
`maintenance/SettingsDiffPanel.tsx`, notification-trigger configuration controls, and custom
chat/sidebar/window interactions for follow-up. They use domain-specific or dense native behavior
outside the named migration surfaces.

## 6. Files touched

- `frontend/components.json` — set the stale `iconLibrary` value to `lucide` before running the CLI; keep
  the existing `base-mira` style and aliases
- `frontend/src/renderer/components/ui/checkbox.tsx` **(new)**
- `frontend/src/renderer/components/ui/radio-group.tsx` **(new)**
- `frontend/src/renderer/components/ui/dropdown-menu.tsx` **(new)**
- `frontend/src/renderer/components/ui/field.tsx` and/or `label.tsx` **(new, only if required)**
- `frontend/src/renderer/components/layout/MoreMenu.tsx`
- `frontend/src/renderer/components/settings/SimpleSettings.tsx`
- `frontend/src/renderer/components/settings/sections/GeneralSection/index.tsx`
- `frontend/src/renderer/components/common/CopyButton.tsx`
- `frontend/src/renderer/components/common/RepositoryDropdown.tsx`
- `frontend/src/renderer/components/layout/GlobalContentView.tsx`
- `frontend/src/renderer/components/dashboard/HistoryBrowser.tsx`
- `frontend/src/renderer/components/dashboard/DashboardView/CommandSearch.tsx`
- audited settings and maintenance form call sites, including `AgentDetailEditor.tsx`,
  `CommandDetailEditor.tsx`, `ConfigBackupPanel.tsx`, `CategoryCleanupPanel.tsx`,
  `ClaudeJsonPanel.tsx`, `PermissionsPanel.tsx`, `MCPStatusPanel.tsx`,
  `ProjectSettingsPanel.tsx`, and `RetentionPolicyPanel.tsx`

## 7. Tasks (ordered)

0. Confirm the `impeccable` skill and read the current `frontend/components.json` plus every incumbent UI
   wrapper involved in the migration.
1. Inventory raw inputs, selects, textareas, buttons, checkbox inputs, radio roles, and manual menu
   assemblies. Classify each as migratable, intentionally native, or domain-specific.
2. Correct `frontend/components.json`'s stale icon-library value, then import only the approved missing
   shadcn wrappers with the existing Base UI configuration. Verify generated imports before wiring
   any call site.
3. Migrate the named menu, mode-selector, form, search, history, and copy call sites. Preserve
   controlled state, validation, error messages, loading states, and persistence behavior.
4. Add focused tests for any new wrapper adapters or pure classification helpers. Keep behavior
   tests at the call-site boundary where the existing test setup supports it.
5. Run the source inventory again, document intentional exceptions, run the UI detector, and close
   the sprint only after keyboard and focus checks pass in both modes.

## 8. Verification / acceptance

- Set `frontend/components.json` `iconLibrary` to `lucide`, then run
  `bunx shadcn@latest add checkbox radio-group dropdown-menu label` from `frontend/`.
- `bun run typecheck`
- `bun run test`
- `bun run qa`
- `node /Users/stevenevan/.agents/skills/impeccable/scripts/detect.mjs --json` over every changed
  UI file
- A source audit confirms no `@radix-ui/*` import and no second icon dependency.

Manual acceptance:

- More opens as a real menu, supports keyboard navigation, closes on Escape, and returns focus to
  its trigger.
- Interface mode is a real radio group in Simple and Nerd Settings; arrow/Tab behavior and checked
  state remain correct.
- Migrated checkboxes, fields, selects, and buttons retain labels, disabled/error states, and
  saved values.
- Copy, search, History, and form surfaces show no visual or focus regression.

## 9. Accessibility

- Use the primitive's native keyboard, focus, checked, expanded, and disabled semantics; do not
  recreate them with `role` attributes when a Base UI wrapper provides them.
- Every generated control has an accessible name and a visible focus indicator.
- Menus use menu items, not buttons with a manually applied `role="menuitem"` inside a generic
  popover.
- Labels remain associated with their controls; validation and async save failures remain adjacent
  and announced.

## 10. Dependencies

The Base UI-backed shadcn layer from UX-01–12, `@base-ui/react` already present in
`frontend/package.json`, and the existing `lucide-react` icon system.

## 11. Risks / open questions

- The shadcn registry may generate a wrapper API that differs from the installed Base UI version.
  Stop and adapt the wrapper before migrating call sites; do not add a compatibility dependency.
- Some native selects are intentionally used for dense or form-like maintenance controls. If Base
  UI Select changes their keyboard, form, or mobile behavior, retain NativeSelect and record the
  exception.
- Broad raw-control counts include custom chat and window interactions. Treating every `<button>`
  as a migration target would change behavior and exceed one week; the audited exception list must
  separate those cases from ordinary form controls.
