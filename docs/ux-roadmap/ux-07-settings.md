# UX-07 — Settings

Rail visibility: **simple-rail** ("Settings") · Depends on: 01 · See [README.md](README.md)

## 1. Goal

Cut nine tabs down to one readable page in Simple mode, with the mode switch itself the first thing
on it, and keep all nine for Nerd mode.

## 2. Today

Root is `settings/SettingsView.tsx` with `settings/SettingsTabs.tsx`. Nine tabs
(`SettingsTabs.tsx:41-49`): General, Connection, Workspaces, Claude Code, Notifications, Shortcuts,
Themes, Plugins, Advanced — four of them `desktopOnly`. Sections live in
`settings/sections/` (`AdvancedSection`, `ClaudeCodeSection`, `ConnectionSection`,
`GeneralSection`, `KeyboardShortcutsSection`, `NotificationsSection`, `PluginsSettings`,
`ThemeEditor`, `WorkspaceSection`), with `settings/components/` for the reusable controls and
`settings/NotificationTriggerSettings/` as a form subsystem of its own.

Problems for a non-technical reader:

- **Nine tabs is a filing system, not a settings page.** A user looking for "make the text bigger"
  has nine guesses, and the answer is in a tab called "Advanced" or "Themes" depending.
- **Tab names are subsystem names.** "Connection", "Workspaces", "Claude Code" name parts of this
  app's architecture. "Advanced" names nothing at all.
- **Genuinely dangerous settings sit beside cosmetic ones.** `AdvancedSection` and
  `ClaudeCodeSection` reach into `~/.claude` configuration; theme choice does not. Same visual
  weight, same nesting depth.
- **`BackendDebugPanel.tsx`** is in the settings tree. It is a developer tool, and in Simple mode it
  should not exist.
- **No search.** Nine tabs of controls and no way to find one by name.

## 3. Simple view

```
+--------------------------------------------------------------+
|  Settings                                                    |
|                                                              |
|  How much detail do you want?                                |
|  +--------------------------------------------------------+  |
|  |  ( ) Simple    Plain language, less on screen          |  |
|  |  (o) Detailed  Everything, including technical detail  |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  Appearance                                                  |
|    Theme            [ Dark  v ]                              |
|    Text size        [ Normal v ]                             |
|                                                              |
|  Alerts                                                      |
|    Notify me           [ on  ]                               |
|    Play a sound        [ off ]                                |
|                                                              |
|  Starting up                                                 |
|    Open when I log in  [ off ]                                |
|    Start on            [ Conversations v ]                    |
|                                                              |
|  Where Claude keeps its files                                |
|    /Users/you/.claude               [ Change ]               |
|                                                              |
|  ------------------------------------------------            |
|  [ Show all settings ]                                       |
+--------------------------------------------------------------+
```

Rules:

- **One scrolling page, four or five labelled groups.** No tabs.
- **The mode switch is first**, phrased as a question about detail rather than as a jargon toggle.
  "Simple" and "Detailed" are the user-facing labels; `simple` and `nerd` remain the stored values.
- Only settings a non-technical user would plausibly change: theme, text size, notifications on/off
  and sound, launch at login, which page opens first, and the Claude data folder.
- **The data-folder path is the one absolute path Simple mode shows.** It is the exception to the
  vocabulary rule in [README.md](README.md) §7, because the setting is meaningless without it.
- "Show all settings" switches to the full tabbed view for one visit **without changing the mode**
  — a user should be able to reach a setting without committing to a different app.
- No Connection, Workspaces, Claude Code, Shortcuts, Plugins, Advanced, or debug panel.

## 4. Nerd view

Today's nine tabs, unchanged, including `BackendDebugPanel`. Additions:

- A settings search field that filters controls by name across all tabs.
- The mode control appears in General, where sprint 01 put it.
- `AdvancedSection` and `ClaudeCodeSection` get a visual marker distinguishing settings that write
  to `~/.claude` from settings that only affect this app — the distinction exists today only in the
  reader's head.

## 5. Words

| Today | Simple | Nerd |
|---|---|---|
| Settings | Settings | Settings |
| (mode toggle) | "How much detail do you want?" — Simple / Detailed | UI mode — simple / nerd |
| General | Appearance / Starting up (split) | General |
| Notifications | Alerts | Notifications |
| Themes | Theme (one control) | Themes |
| Connection | — (hidden) | Connection |
| Workspaces | — (hidden) | Workspaces |
| Claude Code | — (hidden) | Claude Code |
| Shortcuts | — (hidden) | Shortcuts |
| Plugins | — (hidden) | Plugins |
| Advanced | — (hidden) | Advanced |
| `claudeRootPath` | "Where Claude keeps its files" | Claude root path |
| `defaultTab` | "Start on" | Default tab |
| `launchAtLogin` | "Open when I log in" | Launch at login |

## 6. Files touched

- `frontend/src/renderer/components/settings/SettingsView.tsx`
- `frontend/src/renderer/components/settings/SettingsTabs.tsx` — Nerd only
- `frontend/src/renderer/components/settings/SimpleSettings.tsx` **(new)** — the Simple page
- `frontend/src/renderer/components/settings/sections/GeneralSection/` — the mode control's home
- `frontend/src/renderer/components/settings/components/` — reuse `SettingRow`, `SettingsToggle`
  and the rest rather than writing new controls

## 7. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `settings/components/` and build the Simple page **entirely** from the existing controls
   (`SettingRow`, `SettingsToggle`, …). If a control is missing, add it there, not inline.
2. `SimpleSettings.tsx` — the groups in §3, in that order, mode switch first.
3. Branch `SettingsView.tsx` on `useUIMode()`.
4. "Show all settings" — renders the tabbed view for the current visit without writing `uiMode`.
   This is view state, not config.
5. Confirm the mode control still uses `handleUIModeChange` from sprint 01 and that this sprint has
   not re-implemented it. See [README.md](README.md) §12.
6. Nerd mode: settings search across tabs.
7. Nerd mode: mark the sections that write to `~/.claude`.

## 8. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`
- `bun run test -- configValidation` — settings writes go through the validated `general` section;
  that suite guards it.
- **Any test touching a settings-write path must redirect `$HOME` first.** Writers hardcode
  `$HOME/.claude` and ignore the root argument, so a test that does not redirect will clobber the
  real `~/.claude/settings.json`.

Simple mode:

- One page, no tabs. The mode switch is the first control.
- Changing theme, notifications, launch-at-login and start-page all persist across a restart.
- "Show all settings" reveals the tabs and does **not** change the stored mode — verify by
  restarting: the app comes back Simple.
- No debug panel anywhere.

Nerd mode:

- All nine tabs present and functional, matching today.
- Settings search finds a control by name across tabs.
- Sections that write to `~/.claude` are visually distinguished.

## 9. Accessibility

- The mode switch is a labelled radio group, not two unlabelled buttons — it is a choice between
  two states, and radios say that.
- Every control has a real `<label>` associated with it, not a nearby `<span>`.
- Groups are `<fieldset>`/`<legend>` or labelled regions with real headings.
- Changing a setting confirms itself — a toggle that saves silently gives no feedback that it saved.
- The tab list in Nerd mode keeps proper tab semantics and arrow-key navigation.

## 10. Dependencies

Sprint 01 — this page hosts the control sprint 01 built. It **inherits** that control's behaviour
and restyles it; it does not redesign what it does.

## 11. Risks / open questions

- **"Text size" may not exist as a setting.** The app has `useZoomFactor`, which may be the honest
  home for it. If there is no text-size setting today, either wire the Simple control to zoom or
  drop the row — do not ship a control that does nothing.
- Four of the nine tabs are `desktopOnly` (`SettingsTabs.tsx:42-44`). The Simple page must not
  render a group whose only contents are desktop-only when running elsewhere.
- "Show all settings" as view-only state is easy to get wrong by persisting it. If it writes
  anything to config, it has become a third mode — which [README.md](README.md) rules out.
- The Simple page is a curation decision. Every setting omitted is one a user might need; the
  escape hatch is "Show all settings", and it must be easy to find, not buried at the bottom in
  muted text.
