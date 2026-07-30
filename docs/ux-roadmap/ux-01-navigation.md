# UX-01 — Navigation Shell and the Mode Switch

Rail visibility: **not-on-the-rail** (this is the shell itself) · Depends on: — · See
[README.md](README.md)

## 1. Goal

Build the two-mode shell: a six-item rail plus "More" in Simple, today's fifteen-item rail in
Nerd, the `uiMode` plumbing that both read, and the search field the app has never had.

## 2. Today

Shell composition root is `layout/TabbedLayout.tsx`, which mounts `CustomTitleBar`,
`UpdateBanner`, `CommandPalette`, `ActivityBar`, `Sidebar`, `PaneContainer`, `UpdateDialog`,
`WorkspaceIndicator`, `OnboardingTour`, `SshStatusIndicator`, and calls `useKeyboardShortcuts()`
(`TabbedLayout.tsx:20, 37-49`). `HelpPanel`, `ShortcutCheatSheet` and `ConfirmDialog` are mounted
one level up in `App.tsx:56-62`, not in the layout tree. `TabBar` is rendered by `PaneView.tsx`,
not by `PaneContainer`. Page routing is a flat conditional list in `PaneContent.tsx:109-131`.

Problems for a non-technical reader:

- **Fifteen unlabelled icons.** The rail is icon-only with a tooltip on hover
  (`ActivityBar.tsx:111-257`). Nothing tells you what "Task Graph" or "Marketplace" is before you
  click it, and there is no visual grouping — Projects and Maintenance look equally important.
- **The digit tooltips lie.** Rail items advertise `shortcut="1"` … `"7"`
  (`ActivityBar.tsx:128-180`), but `Cmd+[1-9]` switches to the *tab at that index within the
  focused pane* (`hooks/useKeyboardShortcuts/handleShortcutKeyDown.ts:186-195`). There is no
  digit-to-activity binding anywhere. Only `Cmd+,` (Settings) and `Cmd+Shift+F` (Search) do what
  the rail implies.
- **No search field.** `setActiveActivity('search')` has exactly one call site, bound to
  `Cmd+Shift+F`. `CustomTitleBar.tsx` contains no input. A user who does not know the shortcut
  cannot search at all. `GlobalContentView.tsx` has a search box, but only two pages use it
  (Plugins, Annotations).
- **Split panes are the default reading model.** Dragging a tab onto a pane edge creates a new
  pane (`PaneContainer.tsx:65-66`). Powerful, and meaningless to someone who wants to read one
  conversation.
- **A reachable dead end.** `setActiveActivity` sets `activeActivity` and nothing else.
  `PaneContent` then arbitrates against `activeTabId` with a fourteen-way `isGlobalActivity`
  disjunction (`PaneContent.tsx:87-100`) — and `projects` is **not in it** (`:109`). So with any
  tab open, clicking Projects sets the activity, `showGlobalContent` stays `false`, and the
  session tab keeps rendering under a rail item that shows itself selected. Today the TabBar makes
  that recoverable: you see the tab and close it. **Hiding the TabBar in Simple mode removes the
  only affordance for `activeTabId` while leaving the state live.**
- **The command palette does not navigate.** It searches projects and conversations and exports
  sessions (`search/CommandPalette/index.tsx:60, 114-117, 161`). It has no page-navigation
  entries, so it is not a fallback route to a hidden page.

## 3. Simple view

```
+----+--------------------------------------------------------------+
| CD |  [search conversations, projects...          ]  (Cmd+Shift+F)|
+----+--------------------------------------------------------------+
|    |                                                              |
| [] |  Conversations                                               |
| Co |                                                              |
|    |    my-project                              2 hours ago       |
| [] |    12 conversations                                          |
| Co |                                                              |
|    |    another-project                         yesterday         |
| [] |    3 conversations                                           |
| Ta |                                                              |
|    |                                                              |
| [] |                                                              |
| Al |                                                              |
|    |                                                              |
| [] |                                                              |
| Mo |                                                              |
|----|                                                              |
| [] |  <- Help                                                     |
| [] |  <- Settings                                                 |
+----+--------------------------------------------------------------+
```

Rules:

- Six rail items, each with a **visible text label** under its icon: Conversations, Cost, Tasks,
  Alerts, More; Help and Settings pinned at the bottom. Labels are what make the rail legible;
  tooltips are not a substitute.
- "More" opens a popover listing the nine behind-More pages with labels and one-line
  descriptions. Nothing is unreachable.
- **No tab bar, no split panes.** One view at a time.
- A search field lives in the shell header, always visible.
- The sidebar still appears for Conversations (sprint 02 owns its contents).

## 4. Nerd view

```
+----+--------------------------------------------------------------+
| CD | tab: my-project/session-a x | tab: another x |     [+]       |
+----+--------------------------------------------------------------+
|    |                                                              |
| [] |  (fifteen rail icons, current behaviour, tooltips + shortcut) |
| [] |                                                              |
| [] |    +--------------------+  +--------------------+            |
| [] |    |  pane 1            |  |  pane 2            |            |
| [] |    |                    |  |                    |            |
| [] |    +--------------------+  +--------------------+            |
| .. |                                                              |
+----+--------------------------------------------------------------+
```

Unchanged from today: the fifteen-item rail, tab bar, split panes, drag-to-split, the command
palette, every keyboard shortcut. What changes: the rail's two `isDesktopMode()` fragments are
unpicked so item order is data-driven rather than positional, and the digit tooltips are made
honest (see task 7).

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Projects | Conversations | Projects |
| Analytics | Cost | Analytics |
| Todos | Tasks | Todos |
| Notifications | Alerts | Notifications |
| Task Graph | — (behind More, "How tasks connect") | Task Graph |
| Marketplace | — (behind More, "Find add-ons") | Marketplace |
| Maintenance | — (behind More, "Free up space") | Maintenance |
| Transcripts | — (behind More, "Helper transcripts") | Transcripts |
| (no label at all) | visible text label per rail item | tooltip, as today |

## 6. Files touched

Rust:

- `src-tauri/src/config/state/types.rs` — `ui_mode: String` on `GeneralConfig`, default `"nerd"`
  (see [README.md](README.md) §5, release gate).
- `src-tauri/src/config/state/validation.rs` — `ALLOWED_GENERAL_KEYS` + a `VALID_UI_MODES` check
  mirroring the existing `theme` / `defaultTab` shape.
- `src-tauri/src/config/state/manager.rs` — a branch in `merge_into_general`, and the one-time
  migration in `merge_config_with_defaults`.

Frontend:

- `frontend/src/shared/types/notifications/appConfig.ts` — `uiMode: 'simple' | 'nerd'` on
  `general`.
- `frontend/src/renderer/hooks/useUIMode.ts` **(new)** — the single accessor, `localStorage`-seeded.
- `frontend/src/renderer/components/layout/ActivityBar.tsx` — rail split, labels, More popover.
- `frontend/src/renderer/components/layout/MoreMenu.tsx` **(new)** — the More popover.
- `frontend/src/renderer/components/layout/ShellSearchField.tsx` **(new)** — the shell search field.
- `frontend/src/renderer/components/layout/TabbedLayout.tsx` — mount the search field; gate the
  tab bar and pane chrome on mode.
- `frontend/src/renderer/components/layout/PaneView.tsx` — hide `TabBar` in Simple.
- `frontend/src/renderer/components/layout/PaneContainer.tsx` — disable split zones in Simple.
- `frontend/src/renderer/components/layout/PaneContent.tsx` — the reconciliation fix (task 5).
- `frontend/src/renderer/components/settings/sections/GeneralSection` — the mode control.
- `frontend/src/renderer/components/settings/hooks/useSettingsHandlers/useGeneralHandlers.ts` —
  `handleUIModeChange`.
- `frontend/src/renderer/components/onboarding/OnboardingTour.tsx` + `tourReducer.ts` — the choice
  screen.

## 7. Tasks (ordered)

0. **Load the `impeccable` skill** before any UI work, per `~/.claude/rules/frontend.md`.
1. Rust: `ui_mode` on `GeneralConfig` (default `"nerd"`), allowlist + value validation, per-key
   merge. Verify with `cargo test -p claude-devtools config` before touching the frontend.
2. Rust: the one-time migration in `merge_config_with_defaults` — raw `general` lacks `uiMode` and
   raw `onboardingCompleted` is `true` → `nerd`. Add a unit test with both raw shapes.
3. Frontend: `AppConfig` type + `useUIMode()` with its `localStorage` seed, mirroring
   `useTheme.ts:29-37`.
4. Settings → General: the mode control using a new
   `handleUIModeChange(value: 'simple' | 'nerd')`. **Not** `handleGeneralToggle` — see
   [README.md](README.md) §12.
5. **Tab/activity reconciliation.** Pick one and implement it in `PaneContent.tsx`: either Simple
   mode's `setActiveActivity` clears the focused pane's `activeTabId`, or Simple never opens more
   than one tab. Whichever is chosen, `activeActivity` becomes the single source of truth in
   Simple mode and `isGlobalActivity` stops being load-bearing there. This task exists because the
   dead end in §2 becomes unrecoverable once the TabBar is hidden — do not skip it.
6. `ActivityBar`: data-driven item list, visible labels, Simple/Nerd split, `MoreMenu` popover.
   Unpick the two `isDesktopMode()` fragments.
7. Make the digit tooltips honest: either bind `Cmd+[1-9]` to activities, or remove the
   `shortcut` prop from rail items that have no binding. Do not silently renumber them while
   reordering the rail.
8. `ShellSearchField`, mounted in `TabbedLayout`, routing to `activeActivity === 'search'`.
9. Gate the tab bar (`PaneView`) and split zones (`PaneContainer`) on Simple mode.
10. Onboarding: one screen offering Simple or Nerd, writing through `handleUIModeChange`.

## 8. Verification / acceptance

Commands:

- `bun run test:rust` — the two new Rust tests pass (validation rejects `uiMode: "expert"`;
  migration sets `nerd` for a raw config with `onboardingCompleted: true` and no `uiMode`).
- `bun run typecheck`
- `bun run test`
- `bun run qa`

Manual, Simple mode:

- Rail shows six labelled items plus Help and Settings. No tab bar. Dragging does not split.
- "More" lists all nine behind-More pages and each opens.
- Open a conversation, then click Conversations: **the conversation list appears.** This is the
  regression test for task 5.
- The search field is visible without knowing any shortcut, and finds a conversation.

Manual, Nerd mode:

- Rail shows fifteen items. Tab bar present. Drag-to-split works. Every shortcut behaves as before.
- Toggling Simple → Nerd → Simple in Settings persists across a restart.
- Cold start does not flash six items then expand to fifteen.

## 9. Accessibility

- Rail keeps `role="tablist"` / `role="tab"` / `aria-selected` / `aria-label`
  (`ActivityBar.tsx:59-61`). Visible labels supplement `aria-label`; they do not replace it.
- The More popover is keyboard-openable and arrow-navigable, and returns focus to its trigger on
  close.
- Switching mode is announced via a live region — a rail that silently loses nine items is
  disorienting for a screen-reader user.
- The search field has a real `<label>` or `aria-label`, not placeholder-only labelling.

## 10. Dependencies

None. Every other sprint depends on this one.

## 11. Risks / open questions

- **The six-item premise is unverified.** That a shorter rail helps the target audience is the
  assumption this whole roadmap rests on, and it cannot be settled by reading code. Ship behind
  the toggle and watch one non-technical person use it before committing to sprints 02–15.
- Persisting `uiMode` re-runs `sync_autostart` (`src-tauri/src/commands/config.rs:51-55`) because
  that fires on any `general` write. Idempotent and harmless; noted so nobody rediscovers it in a
  debugger.
- Task 5's two options are not equivalent. Clearing `activeTabId` is smaller; single-tab Simple
  mode is more predictable but touches `paneSlice`. Decide before starting, and record which in
  this file.
- Default ships as `nerd` deliberately. Do not "fix" it to `simple` — that flip is sprint 15's
  final task, per [README.md](README.md) §5.
