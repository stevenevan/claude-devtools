# UX-01 — Navigation Shell and the Mode Switch

Rail visibility: **not-on-the-rail** (this is the shell itself) · Depends on: — · See
[README.md](README.md)

## 1. Goal

Build the two-mode shell: seven Simple rail controls including More, today's fifteen-item rail in
Nerd, shared `uiMode` plumbing, and shell-owned global search.

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

- Seven rail controls, each with a **visible text label** under its icon: Conversations, Cost,
  Tasks, Alerts, and More in the main section; Help and Settings pinned at the bottom. Labels are
  what make the rail legible; tooltips are not a substitute.
- "More" opens a popover listing the nine behind-More pages with labels and one-line
  descriptions. Nothing is unreachable.
- **No tab bar or sidebar, and no split panes.** Simple unmounts sidebar and tab chrome while
  preserving the Nerd pane topology unchanged for its return.
- A search field lives in the shell header, always visible. It owns global search and routes
  non-empty queries to SearchView; Conversations has no local input. Per-session find remains
  separate.

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

The shell-global search field remains available in Nerd and routes to the same SearchView as Simple.
Otherwise unchanged from today: the fifteen-item rail, tab bar, split panes, drag-to-split, command
palette, and every keyboard shortcut. What changes: the rail's two `isDesktopMode()` fragments are
unpicked so item order is data-driven rather than positional, and the digit tooltips are made honest
(see task 7).

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
- `frontend/src/renderer/components/layout/TabbedLayout.tsx` — mount shell search and choose the
  mode shell without destroying tabs or panes.
- `frontend/src/renderer/components/layout/PaneView.tsx` — unmount `TabBar` in Simple.
- `frontend/src/renderer/components/layout/PaneContainer.tsx` — disable drag/drop split zones in
  Simple.
- `frontend/src/renderer/components/layout/PaneContent.tsx` — make `activeActivity` authoritative
  in Simple.
- `frontend/src/renderer/hooks/useKeyboardShortcuts/handleShortcutKeyDown.ts` and
  `frontend/src/renderer/store/slices/paneSlice.ts` — block keyboard and direct-store pane
  creation in Simple.
- Existing UI/search store domain — shell-global query state, distinct from per-session find.
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
5. **Tab/activity reconciliation.** In Simple, `activeActivity` is authoritative in
   `PaneContent.tsx`; selecting a rail destination cannot leave session content displayed beneath
   it. Preserve existing Nerd tabs and pane topology without mutation so returning to Nerd restores
   them.
6. `ActivityBar`: data-driven item list, visible labels, seven-control Simple rail, `MoreMenu`
   popover, and pinned Help/Settings. Unpick the two `isDesktopMode()` fragments.
7. Remove misleading digit shortcut labels. `Cmd+[1-9]` remains pane-tab switching in Nerd.
8. `ShellSearchField`, mounted in `TabbedLayout`, owns one global query in both modes. A non-empty
   query routes to global SearchView; it does not filter a loaded Conversations page. Preserve
   per-session find separately, and leave Plugins and Annotations filters page-local.
9. Unmount tab chrome and disable drag/drop split zones in Simple. Also guard `Cmd+\`, `splitPane`,
   and `moveTabToNewPane` using effective bootstrap mode, so keyboard, drag/drop, visual, and
   direct-store callers cannot create a pane in Simple.
10. Onboarding: require an explicit Simple or Nerd selection before Continue. Skip and reset write
    Nerd until UX-15; fresh and missing mode values also remain Nerd.

## 8. Verification / acceptance

Commands:

- `bun run typecheck`
- `bun run test` — Bun-native pure and store tests cover shell query routing, bootstrap-mode
  reconciliation, activity routing, pane-creation guards, and Nerd → Simple → Nerd restoration.
- `bun run qa`

Manual Tauri verification, Simple mode:

- Rail shows seven labelled controls: Conversations, Cost, Tasks, Alerts, More, Help, and Settings.
  Help and Settings remain pinned. No tab bar or sidebar. Dragging, keyboard shortcuts, and direct
  store actions do not create a pane.
- "More" lists all nine behind-More pages and each opens.
- Open a conversation, then click Conversations: **the conversation list appears.** This is the
  regression test for task 5.
- The shell search field is visible without knowing a shortcut and routes a non-empty query to
  global SearchView. Per-session find remains separate.

Manual Tauri verification, Nerd mode:

- Rail shows fifteen items. Tab bar present. Drag-to-split works. Every shortcut behaves as before.
- Toggling Nerd → Simple → Nerd restores prior tabs and panes, and persists across a restart.
- Cold start does not render Simple rail before the cached or Rust-confirmed Nerd mode.

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

- **The shorter-rail premise is unverified.** That a reduced rail helps the target audience is the
  assumption this roadmap rests on, and it cannot be settled by reading code. Ship behind the
  toggle and watch one non-technical person use it before committing to sprints 04–15.
- Persisting `uiMode` re-runs `sync_autostart` (`src-tauri/src/commands/config.rs:51-55`) because
  that fires on any `general` write. Idempotent and harmless; noted so nobody rediscovers it in a
  debugger.
- Simple keeps Nerd topology non-destructively, but every pane-creation entry point must consult
  effective bootstrap mode. A visual-only guard would leave hidden panes or state-created splits.
- Default ships as `nerd` deliberately. Do not "fix" it to `simple` — that flip is sprint 15's
  final task, per [README.md](README.md) §5.
