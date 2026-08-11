# UX-15 — Maintenance

Rail visibility: **behind-More** ("Free up space") · Depends on: 01, and every sprint before it ·
See [README.md](README.md)

## 1. Goal

Reduce twenty-five maintenance panels to one honest Simple view — how much space is used, and one
safe way to reclaim it — without making anything destructive easier to reach. Then flip the release
gate.

## 2. Safety obligations, before anything else

This page deletes files. Two rules govern every task in this sprint:

- **No work here may weaken an existing confirmation, dry-run, or trash-backup step.** If a
  simplification removes a guard, the simplification is wrong.
- **Simple mode must not make destructive actions easier to reach than they are today.** Fewer
  panels means fewer ways to delete things, not a faster path to deleting them.

And one specific, recorded hazard, quoted from `CLAUDE.md`:

> **Unverified, and load-bearing:** Restore has no backup step. `maintenance/trash.rs` confines
> every path to `[claude root, app-data]`, so it refuses real restore targets, and no pre-write copy
> was added in its place. The macOS save dialog's replace prompt is therefore the only thing standing
> between `Restore to original…` and an unrecoverable overwrite of a live file — and that prompt has
> never been confirmed by clicking through the app.

`FileHistoryBrowserPanel`'s `Restore to original…` is therefore **excluded from Simple mode
entirely**, and this sprint does not restyle it in Nerd mode either. Touching its UI without first
confirming that prompt would be putting a friendlier face on an unverified overwrite path. If this
sprint confirms the prompt, it records the result in `CLAUDE.md`; if it does not, the exclusion
stands.

## 3. Today

Root is `maintenance/MaintenanceView.tsx` (167 lines), a tab host for twenty-five panels
(`MaintenanceView.tsx:45-93`): Plugins, Transcripts, File History, Junk, Runtime, Plans, Projects,
Backups, Logs, Caches, History, Health, Settings Diff, Project Settings, Instructions, claude.json,
MCP, Permissions, Memory, Config Backup, Retention, Shell Snapshots, Usage, Storage, Trash.

Problems for a non-technical reader:

- **Twenty-five tabs, most of them named after directories.** "Runtime", "Junk", "Plans",
  "claude.json", "MCP" are the names of things on disk, not of things a user wants to do.
- **Cleanup and inspection are interleaved.** `HealthPanel`, `MCPStatusPanel`, `SettingsDiffPanel`
  and `UsageStatsPanel` inspect; the `*CleanupPanel`s delete. Same tab strip, same weight.
- **Deletion is the page's main verb**, and there is no single view of what is actually taking up
  space — `StorageTable` exists but is one tab among twenty-five.
- **`ClaudeJsonPanel` and `PermissionsPanel` edit Claude Code's own configuration.** These are the
  highest-consequence controls in the app and they sit beside a cache cleaner.

## 4. Simple view

```
+--------------------------------------------------------------+
|  Free up space                                               |
|                                                              |
|  Claude keeps logs and old file versions on your computer.   |
|  This is safe to clear — your conversations stay.            |
|                                                              |
|      Using 2.4 GB                                            |
|                                                              |
|    Old file versions             1.6 GB                      |
|    Logs and caches               0.7 GB                      |
|    Everything else               0.1 GB                      |
|                                                              |
|  [ Clear old files ]                                         |
|                                                              |
|  Items you clear go to Trash first, so you can get them      |
|  back.                                                       |
|                                                              |
|  ------------------------------------------------            |
|  [ Show all maintenance tools ]                              |
+--------------------------------------------------------------+
```

Rules:

- **One number: total space used.** Then a three-line breakdown, in categories named by what they are
  to a user, not by directory.
- **One action: "Clear old files".** It runs the existing dry-run, shows what would be removed, and
  requires confirmation. It uses the **existing** cleanup path with its trash-backup — it does not
  introduce a new delete.
- **The trash-backup is stated in the UI**, because "you can get it back" is what makes the action
  safe to offer at all.
- **Excluded from Simple mode:** every config editor (`ClaudeJsonPanel`, `PermissionsPanel`,
  `ProjectSettingsPanel`, `InstructionsPanel`, `MemoryPanel`, `SettingsDiffPanel`,
  `RetentionPolicyPanel`), every inspector (`HealthPanel`, `MCPStatusPanel`, `UsageStatsPanel`,
  `ShellSnapshotPanel`), and `FileHistoryBrowserPanel`'s restore per §2.
- "Show all maintenance tools" opens the full tabbed view for this visit **without changing the
  mode** — same escape-hatch pattern as [ux-07](ux-07-settings.md) §3.

## 5. Nerd view

Today's twenty-five tabs, unchanged in behaviour. Additions, all additive:

- Tabs grouped into **Clean up**, **Inspect**, and **Configure**, so deletion and configuration stop
  sharing a strip. Grouping only — no panel moves, no panel is renamed.
- `StorageTable` promoted to the first tab, since "what is using space" is the question that brings
  people here.
- Panels that write to `~/.claude` marked, consistent with [ux-07](ux-07-settings.md) §4.

`FileHistoryBrowserPanel` is not restyled. See §2.

## 6. Words

| Today | Simple | Nerd |
|---|---|---|
| Maintenance | Free up space | Maintenance |
| File History | Old file versions | File History |
| Junk / Runtime / Caches / Logs | Logs and caches | as today |
| Plans / Projects / Backups | Everything else | as today |
| Trash | Trash (explained: "you can get them back") | Trash |
| Dry run | "Show me what would be removed" | Dry run |
| Retention policy | — (hidden) | Retention policy |
| claude.json / MCP / Permissions | — (hidden) | as today |
| Restore to original… | — (excluded, see §2) | Restore to original… (unchanged) |

## 7. Files touched

- `frontend/src/renderer/components/maintenance/MaintenanceView.tsx` — Simple branch, Nerd grouping
- `frontend/src/renderer/components/maintenance/SpaceSummary.tsx` **(new)** — the Simple view
- `frontend/src/renderer/components/maintenance/StorageTable.tsx` — the data behind the breakdown
- `src-tauri/src/config/state/types.rs` — the release-gate flip (task 8)

**Not touched:** `FileHistoryBrowserPanel.tsx`, and no `*CleanupPanel` internals. The Simple action
calls existing cleanup commands; it does not reimplement them.

## 8. Tasks (ordered)

0. **Load the `impeccable` skill.**
1. Read `StorageTable.tsx` and the category IDs behind the cleanup panels. Establish the mapping from
   real categories to the three user-facing buckets, and record it in this file.
2. Read `DryRunConfirmDialog.tsx` and the `gated` write pattern in
   `src-tauri/src/commands/maintenance/`. The Simple action must go through the same gate and the
   same trash-backup as today.
3. `SpaceSummary.tsx` — total, three-line breakdown, one action, the trash explanation.
4. Wire "Clear old files" to the existing cleanup commands for the safe categories only, via the
   existing dry-run and confirmation. Do not add a new delete path.
5. Branch `MaintenanceView.tsx` on `useUIMode()`; exclude the panels listed in §4 from Simple.
6. "Show all maintenance tools" — view state only, never writes `uiMode`.
7. Nerd mode: group the tabs into Clean up / Inspect / Configure, promote `StorageTable`, mark the
   `~/.claude` writers.
8. **Release gate.** Only after rows 01–14 of the [README.md](README.md) sprint index read `done` and
   tasks 1–7 here are complete: flip the fresh-config default for `uiMode` from `"nerd"` to
   `"simple"` in `src-tauri/src/config/state/types.rs`. One line. Then set row 15 to `done`.

## 9. Verification / acceptance

- `bun run typecheck && bun run test && bun run qa`
- `bun run test:rust` — the default flip changes a Rust default, so the config tests must be updated
  and pass.
- `scripts/qa-rust-grep-gate.sh` must stay green: this sprint adds no direct `dirs::home_dir()` call
  and no new write path.
- **Any test touching a settings-write path must redirect `$HOME` first** — writers hardcode
  `$HOME/.claude` and ignore the root argument, so an unredirected test clobbers the real
  `~/.claude/settings.json`.

Simple mode:

- One total, three categories, one action.
- The action shows what would be removed before removing it, and requires confirmation.
- Cleared items appear in Trash afterwards — verify, do not assume.
- No config editor, no inspector, and no restore control is reachable.
- "Show all maintenance tools" survives a restart as Simple mode.

Nerd mode:

- All twenty-five panels present and behaving as today.
- Tabs grouped; `StorageTable` first; `~/.claude` writers marked.
- `FileHistoryBrowserPanel` is byte-for-byte unchanged.

Release gate:

- After task 8, a fresh config (no `uiMode` key, no `onboardingCompleted`) resolves to `simple`.
- An existing config still resolves to `nerd`.

## 10. Accessibility

- The total is a heading; the breakdown is a table with header cells, not a styled div grid.
- The confirmation dialog names what will be removed and how much space it frees, in text.
- Destructive buttons are never the initially focused element in their dialog.
- In Nerd mode the tab groups are labelled groups, and arrow-key navigation still crosses the whole
  strip rather than stopping at a group boundary.
- Progress during a clear is announced, and completion states how much was freed.

## 11. Dependencies

Sprint 01, and **every** sprint 02–14 — task 8 cannot run until their status rows read `done`.

## 12. Risks / open questions

- **The category mapping is a safety claim.** "This is safe to clear — your conversations stay" must
  be true. If any category in the three buckets can remove session data, it does not belong in the
  Simple action. Settle in task 1 and be conservative: a smaller safe action is correct, a broader
  one that deletes a conversation is a data-loss bug with friendly copy on top.
- **`Restore to original…` remains unverified.** This sprint does not fix it and does not touch it.
  If someone confirms the macOS replace prompt during this sprint, update `CLAUDE.md` — but that is
  separate work, not a task here.
- Trash must actually be a recovery path for what the Simple action clears. If any cleanup category
  bypasses trash, the "you can get them back" line is false for it and that category is excluded.
- Task 8 was the one-line change with the largest blast radius in the roadmap: it changed the
  default experience for every new install only after every sprint 02–14 row was complete.

## 13. Shipped status

UX-15 shipped in the grouped UX-13–15 delivery. Simple mode now uses a backend-owned, tokenized
trash-only cleanup flow with a conservative allowlist; Nerd mode retains the full maintenance
registry with grouped tabs. Fresh config defaults to Simple, while missing persisted `uiMode`
migrates to Nerd.
