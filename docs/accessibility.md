# Accessibility Conventions

## Focus visibility

All interactive controls show a visible focus ring via Tailwind's
`focus-visible:ring-2 focus-visible:ring-primary
focus-visible:outline-none`. Custom widgets (Minimap, FlameGraph,
TreeView) carry the same classes on their interactive children.

## ARIA roles

| Component             | Role / pattern                                           |
| --------------------- | -------------------------------------------------------- |
| ReplayControls        | `role="region"` with `aria-label`; play/pause button uses `aria-pressed`. Speed buttons form a `radiogroup`. Progress bar uses `role="progressbar"` with valuenow / valuemin / valuemax. |
| SessionMinimap        | `role="img"` with descriptive `aria-label` summarising zoom level. |
| ToolFlameGraph        | `role="region"` with `aria-label` summarising count, total ms, depth. |
| SubagentTreeView      | `role="tree"` on the outer container.                    |
| Modal dialogs         | Trap focus on open, restore on close, `Escape` dismisses. |

## Live regions

Time-sensitive announcements (replay play/pause, notification arrivals)
use a hidden `<span aria-live="polite" aria-atomic="true">` rendered
inside the related region. The text is the full sentence, not a
fragment, so screen readers announce a complete phrase.

## Naming conventions

- `aria-label` for icon-only buttons mirrors the visible tooltip.
- Toggle buttons use `aria-pressed` for boolean state, `aria-expanded`
  for collapsible panels.
- Descriptions belong on `aria-describedby`, not `title`, when the
  description is non-trivial.

## Keyboard

- All single-key shortcuts (`g 1`, `j`, `k`, etc.) defer to
  `useKeyboardShortcuts.ts`; focused inputs disable shortcuts that
  would conflict with typing.
- Tab order mirrors visual reading order — never reorder via
  `tabIndex` greater than 0.

## Test sweep

Sprint 48 runs an `axe-core` sweep over ten primary views. The current
infrastructure binding (Playwright + `@axe-core/playwright`) is
deferred — it requires adding npm dev-deps that are blocked in this
environment. The conventions above are enforceable with `oxlint`'s
`jsx-a11y` rule set, which is part of the standard lint command and
already gates the build green.
