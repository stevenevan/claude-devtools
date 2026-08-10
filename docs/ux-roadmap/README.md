# UI/UX Roadmap — Simple and Nerd Modes

Sixteen sprint-weeks that rebuild this app's interface around two audiences instead of one.
UX-01–03 were the first grouped delivery, shipped together as one dependency-complete group.
UX-04–06 are the second grouped delivery: Cost, Tasks, and Alerts share their foundations while
retaining page-level boundaries.
UX-07–10 are the third grouped delivery: Settings, Skills, Agents, and Plugins share the
Simple-mode curation and installable-list pattern.
UX-11–12 are the fourth grouped delivery: Annotations and History share mode-aware labels, safe
authored-data actions, date grouping, and copy feedback.
UX-12.5 is a one-week cross-cutting follow-up that standardizes missing shadcn primitives before
the next page delivery; it is not a new grouped delivery.

## 1. What this roadmap is

The app reads Claude Code's own logs out of `~/.claude/` and reconstructs what happened in a
session. Everything it renders today assumes the reader already knows what a session, a subagent,
a token and a JSONL file are: a fifteen-icon rail with no labels, absolute paths, UUIDs, raw
token counts, and split panes as the default reading experience.

That serves one audience well. This roadmap adds a second without taking anything away from the
first — a `simple` mode that speaks plain language and shows less, and a `nerd` mode that is
today's surface with the raw detail opened rather than hidden.

Each sprint file is written to be implementable without re-deciding anything. Read this file
first; it holds the decisions every sprint depends on.

## 2. Audience

**Primary — non-technical.** Someone who uses Claude Code, wants to see what it did and what it
cost, and does not want to learn a vocabulary to do that. They should never meet a UUID, an
absolute path, or the word "JSONL".

**Secondary — power users.** People who read execution traces, compare token counts, and want
split panes and keyboard navigation. Nerd mode is for them, and it is not a degraded version of
today: it is today plus the raw panels open by default.

Simple mode **hides**; it never forbids. Every page is reachable in both modes.

## 3. The two modes

One persisted value, `'simple' | 'nerd'`, stored at `AppConfig.general.uiMode` and written with
`api.config.update('general', { uiMode })`.

**This is not a frontend-only change.** `general` keys are allowlisted in Rust; an unknown key is
rejected with `general.{k} is not a valid setting`
(`src-tauri/src/config/state/validation.rs:77-83`). Adding `uiMode` requires all four of:

- `ALLOWED_GENERAL_KEYS` plus a value check in `src-tauri/src/config/state/validation.rs`
- a branch in `merge_into_general` (`src-tauri/src/config/state/manager.rs:1185-1207`)
- a field on `GeneralConfig` (`src-tauri/src/config/state/types.rs:15-24`)
- the frontend `AppConfig` type (`frontend/src/shared/types/notifications/appConfig.ts`)

**Defaults and migration.** Until UX-15's release gate, fresh, missing, and reset mode values
resolve to `nerd`. Existing installs without `uiMode` also resolve to `nerd`, so nobody using the
app today wakes up to a restricted rail. An explicit Simple or Nerd selection persists unchanged.

The migration **must happen in Rust**, in `merge_config_with_defaults`
(`src-tauri/src/config/state/manager.rs:142`). It cannot be done in the frontend: config load
overlays the on-disk `general` object onto a fully populated `GeneralConfig::default()`
(`manager.rs:98-106`), so a field with a `Default` impl always materialises and the renderer can
never observe it as absent. `uiMode` is never optional and no third "unset" state crosses IPC into
fourteen pages of branch code.

Note that `onboardingCompleted` is a field on **`AppConfig`**, not on `GeneralConfig`, and it is
written through section `onboarding`, key `completed` — `validate_onboarding` accepts no other key.

**Onboarding** gains one screen offering an explicit Simple or Nerd choice. Continue remains
disabled until selection; Skip and reset deliberately choose `nerd` until UX-15.

## 4. Reading the mode

Exactly one accessor, defined in sprint 01:

```ts
useUIMode(): 'simple' | 'nerd'
```

It is seeded from a `localStorage` cache the way `useTheme` seeds the theme
(`frontend/src/renderer/hooks/useTheme.ts:29-37`). This matters: `appConfig` is `null` until
`fetchConfig()` resolves (`frontend/src/renderer/store/slices/configSlice.ts:78-92`), so without a
cache a Nerd user watches the Simple rail render and then expand to fifteen on every cold start.

**Page sprints read the mode only through `useUIMode()`.** No page reads
`appConfig.general.uiMode` directly, and no page invents its own pre-load fallback.

Words tables are implemented as **per-component conditional labels**, not a shared substitution
map. If a later sprint produces a case that genuinely needs a map, it says so and amends this
file.

## 5. Release gate

Sprint 01 ships with the fresh-config default at **`nerd`**, not `simple`.

The one-line flip to `simple` is the **final task of sprint 15**, gated on every prior sprint row
reading `done` and sprint 15's own preceding tasks being complete. (Gating on every row including
its own would be self-referential — sprint 15 cannot read `done` while its last task runs.)

Without this gate, weeks 1 through 14 hand a fresh install the restricted navigation with none of
the simplified pages behind it: a seven-control rail leading to raw UUIDs and token counts, with
the tab bar and split panes removed. That is worse than shipping nothing.

## 6. Rail contract

Three visibility values. There is no `nerd-only` page class — that would contradict "Simple hides,
never forbids". Split panes and the tab bar are nerd-only *features*, not pages; sprint 01 covers
them.

**simple-rail** — the Simple rail has seven controls. Conversations, Cost, Tasks, Alerts, and More
sit in its main section; Help and Settings remain pinned at its bottom. Nerd keeps these
corresponding destinations on its rail.

| Rail label (Simple) | Rail label (Nerd) | `ActivityView` |
|---|---|---|
| Conversations | Projects | `projects` |
| Cost | Analytics | `analytics` |
| Tasks | Todos | `todos` |
| Alerts | Notifications | `notifications` |
| More | — | — (menu) |
| Help | Help | — (panel) |
| Settings | Settings | `settings` |

**behind-More** — hidden behind More in Simple, on the rail in Nerd: `agents`,
`skills`, `plugins`, `annotations`, `history`, `transcripts`, `marketplace`, `taskGraph`,
`maintenance`.

Five of those nine — `history`, `transcripts`, `marketplace`, `taskGraph`, `maintenance` — sit
inside two `{isDesktopMode() && (…)}` fragments today (`ActivityBar.tsx:181, 225`).
`isDesktopMode` returns `true` unconditionally (`frontend/src/renderer/api/index.ts:24`), so there
is no runtime divergence, but sprint 01 has to unpick two conditional fragments to relocate them.

**not-on-the-rail** — the rail never lists these:

- `search`. The shell owns its one global query field in both modes; `Cmd+Shift+F` focuses the same
  field. A non-empty shell query routes to global SearchView. This is distinct from per-session
  find, which retains its own query, regex state, highlighting, and next/previous navigation.
- The app shell itself (`ux-01`).
- The session view (`ux-03`) — reached by opening a conversation.

## 7. Vocabulary rules

Simple mode substitutes plain language. Each sprint's Words table extends this list; none
contradicts it.

| Concept | Simple | Nerd |
|---|---|---|
| Session | Conversation | Session |
| Project | Folder / Project name | Project |
| Subagent | Helper | Subagent |
| Token / token count | — (hidden; cost shown in currency) | Tokens, cache reads/writes |
| Model ID (`claude-opus-5`) | — (hidden) | Model ID |
| Compaction | "Older messages were summarised" | Compaction boundary |
| Tool call | What Claude did | Tool call, with name |
| JSONL / transcript file | — (hidden) | File path |

**Always hidden in Simple mode**, regardless of page: UUIDs, absolute paths, content hashes, raw
token counts, JSONL and file-format names, model IDs.

Relative time ("2 hours ago") in Simple; absolute timestamps in Nerd.

## 8. Design constraints

Sprints may redesign layout, hierarchy, grouping, density, empty/error/loading states, and copy.
They may **not** introduce a new palette, font, or component library.

- Colours come from the CSS variables in `frontend/src/renderer/index.css`. See
  `.claude/rules/tailwind.md` for the variable catalogue and the theme-aware class conventions.
- Components come from `frontend/src/renderer/components/ui/`; new wrappers are added only through
  the approved shadcn/Base UI parity process. Use the `Button` component, never a bare `<button>`.
- **Icons come from `lucide-react`.** `components.json` declares `"iconLibrary": "remixicon"` and
  that is stale — the only icon dependency in `frontend/package.json` is `lucide-react`, which is
  what the app imports. Do not run the shadcn CLI without overriding it, or future component
  installs will pull in a second icon library.
- No inline `style` props. Tailwind classes only.
- No JSDoc, no `useCallback`, no `React.memo` unless profiling proves a measurable problem.

## 9. Mandatory process

**Every implementation session loads the `impeccable` skill before touching UI**, per
`~/.claude/rules/frontend.md`. Task 0 of every sprint says so. Do not design from framework
defaults.

## 10. Accessibility bar

Every sprint keeps or improves what exists. The rail is already a `role="tablist"` with
`role="tab"`, `aria-selected` and `aria-label` per item (`ActivityBar.tsx:59-61`); none of that
regresses.

- Anything reachable by mouse is reachable by keyboard.
- A mode change is announced, not silent.
- Interactive controls carry an accessible name — icon-only buttons get `aria-label`.
- Focus is visible and never trapped.
- Colour is never the only carrier of meaning.

## 11. Shell freeze

Sprint 01 owns the shell and freezes it. After sprint 01, these files are closed to page sprints:

`layout/TabbedLayout.tsx`, `App.tsx`'s shell mounts, `layout/ActivityBar.tsx`,
`layout/TabBar.tsx`, `layout/PaneContainer.tsx`, `layout/PaneView.tsx`, `layout/PaneContent.tsx`,
`layout/GlobalContentView.tsx`, `layout/CustomTitleBar.tsx`.

`layout/Sidebar.tsx` and `components/sidebar/*` are **not** frozen. The sidebar renders only when
`activeActivity === 'projects'` (`Sidebar.tsx:51`) — it is page chrome for one page, and it
belongs to sprint 02.

A page sprint that needs a frozen file changed **stops and amends this roadmap**. It does not edit
around the freeze.

Two shared files deserve care even though they are frozen: `PaneContent.tsx` routes every page,
and `GlobalContentView.tsx` supplies the page title and search field for both Plugins and
Annotations — a change there hits both.

UX-01 shipped without suppressing `GlobalContentView.tsx`'s page-local search in Simple mode.
The UX-07–10 grouped delivery owns this one-time repair and documents it as an explicit exception
to the freeze before changing the shared file. No later page sprint may edit the file again for
this issue.

UX-11 adds one separate, title-only exception: `GlobalContentView.tsx` may accept an optional
Simple-mode title so Annotations can display `Your notes` while Nerd mode remains `Annotations`.
This exception does not alter search suppression or any other page title.

## 12. Ownership note

Sprint 01 builds the mode control in Settings → General. Sprint 07 restyles the Settings page and
**inherits** that control's behaviour; it does not redesign what the control does.

The control uses a dedicated handler, `handleUIModeChange(value: 'simple' | 'nerd')`, alongside
`handleThemeChange` and `handleDefaultTabChange`. It must not use `handleGeneralToggle`, whose
signature is `(key: keyof AppConfig['general'], value: boolean)` — that would typecheck
`('uiMode', true)` and fail only at runtime inside `validate_general`
(`frontend/src/renderer/components/settings/hooks/useSettingsHandlers/useGeneralHandlers.ts:15-35`).

Also worth knowing: any write to section `general` re-runs `sync_autostart`
(`src-tauri/src/commands/config.rs:51-55`). Persisting `uiMode` therefore rewrites the LaunchAgent
plist. It is idempotent and harmless — but it is surprising in a debugger, so it is recorded here
rather than rediscovered.

## 13. How to read a sprint file

Every `ux-*.md` has the same core sections; completed grouped deliveries may append a Shipped status section:

1. **Goal** — one line.
2. **Today** — the root component, what it renders, and the concrete problems for a
   non-technical reader.
3. **Simple view** — wireframe and the rules behind it.
4. **Nerd view** — wireframe of what the toggle reveals, and what is unchanged from today.
5. **Words** — today's label → Simple → Nerd. `—` means hidden in that mode.
6. **Files touched** — real paths. New files are marked `(new)`.
7. **Tasks (ordered)** — task 0 is always "load the `impeccable` skill".
8. **Verification / acceptance** — runnable commands plus manual criteria per mode.
9. **Accessibility** — criteria specific to this page.
10. **Dependencies** — prior sprints.
11. **Risks / open questions**.

## 14. Sprint index

| # | Sprint | Page | Root component | Rail visibility | Depends on | Status |
|---|---|---|---|---|---|---|
| 01 | [Navigation shell](ux-01-navigation.md) | app shell | `layout/TabbedLayout.tsx` | not-on-the-rail | — | done (grouped) |
| 02 | [Conversations](ux-02-conversations.md) | Projects | `dashboard/DashboardView/` | simple-rail | 01 | done (grouped) |
| 03 | [Session view](ux-03-session-view.md) | session transcript | `layout/SessionTabContent.tsx` | not-on-the-rail | 01, 02 | done (grouped) |
| 04 | [Cost](ux-04-cost.md) | Analytics | `dashboard/AnalyticsDashboard/` | simple-rail | 01 | done (grouped) |
| 05 | [Tasks](ux-05-tasks.md) | Todos | `dashboard/TodosDashboard.tsx` | simple-rail | 01 | done (grouped) |
| 06 | [Alerts](ux-06-alerts.md) | Notifications | `notifications/NotificationsView.tsx` | simple-rail | 01 | done (grouped) |
| 07 | [Settings](ux-07-settings.md) | Settings | `settings/SettingsView.tsx` | simple-rail | 01 | done (grouped) |
| 08 | [Skills](ux-08-skills.md) | Skills | `dashboard/SkillsManager.tsx` | behind-More | 01 | done (grouped) |
| 09 | [Agents](ux-09-agents.md) | Agents | `dashboard/AgentsManager.tsx` | behind-More | 01, 08 | done (grouped) |
| 10 | [Plugins](ux-10-plugins.md) | Plugins | `dashboard/PluginsGrid.tsx` | behind-More | 01, 08 | done (grouped) |
| 11 | [Annotations](ux-11-annotations.md) | Annotations | `sidebar/AnnotationList.tsx` | behind-More | 01, 03 | done (grouped) |
| 12 | [History](ux-12-history.md) | History | `dashboard/HistoryBrowser.tsx` | behind-More | 01 | done (grouped) |
| 12.5 | [shadcn UI parity](ux-12-5-shadcn-ui.md) | UI foundation | `components/ui/` | cross-cutting | 01–12 | planned |
| 13 | [Marketplace](ux-13-marketplace.md) | Marketplace | `dashboard/MarketplaceBrowser.tsx` | behind-More | 01, 10 | planned |
| 14 | [Task Graph](ux-14-task-graph.md) | Task Graph | `dashboard/TaskGraphViewer.tsx` | behind-More | 01, 03 | planned |
| 15 | [Maintenance](ux-15-maintenance.md) | Maintenance | `maintenance/MaintenanceView.tsx` | behind-More | 01, all | planned |

Order rationale: the simple-rail pages come first so the primary audience has a coherent app after
seven sprints rather than fifteen. `ux-03` is the one exception to rail-first — it is not a rail
item, but it is the page Conversations drills into and where a user spends most of their time, so
it follows `ux-02` immediately.

## 15. Uncovered

**The Transcripts page** (`dashboard/TranscriptsViewer.tsx`, `ActivityView` `transcripts`) has no
sprint. Its content is the same shape as the session view, so the patterns `ux-03` establishes
transfer directly and a separate spec would mostly repeat them. It is still assigned
`behind-More` in the rail contract, so sprint 01 places it correctly; only its page body is
unspecified.

If it gets a sprint later, it becomes `ux-16` and this section records that instead.
