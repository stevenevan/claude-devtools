# CDX-09 — Usage, telemetry, and maintenance

Rail visibility: More · Depends on: CDX-01, CDX-02, CDX-03, CDX-04, CDX-08 · See `docs/ux-roadmap/ux-15-maintenance.md`

## 1. Goal

Purpose: bring Codex Usage & Telemetry, File History, and Shell Snapshots into the maintenance area. This week makes operational data inspectable and keeps file restore/save actions local, explicit, and recoverable.

## 2. Today

The app already has `MaintenanceView`, `UsageStatsPanel`, `FileHistoryBrowserPanel`, `ShellSnapshotPanel`, maintenance commands, and typed maintenance/snapshot API adapters. They are built around Claude sources. Codex has `stats-cache.json`, `telemetry/`, `file-history/`, and `shell-snapshots/` data in the product scope, but no Codex maintenance reader or source-specific safety policy.

## 3. Simple view

```text
Codex maintenance

Usage & telemetry       30 days · 1,248 turns
File history            14 tracked files
Shell snapshots         22 snapshots

View details             Refresh
```

Rules:

- Lead with useful summaries, not raw event payloads or command output.
- Show “unavailable”, “empty”, “redacted”, and “stale” as distinct states.
- File History Save as… and Restore to original… must state that they act on the local machine.
- Shell snapshots are read-only; the app never replays a captured command.

## 4. Nerd view

Show source and safety provenance for each maintenance dataset:

| Dataset | Required details |
| --- | --- |
| Usage | period, turns, tokens/cost when available, source file, stale state |
| Telemetry | event count/status, time range, redaction state, no raw sensitive payload |
| File History | tracked file, backup state, server-resolved original path, local write scope |
| Shell Snapshots | timestamp, shell/session label, bounded output preview, redaction state |

Every loader and mutation must carry a typed source context. No component should infer source from a path string.

## 5. Words

| Today | Simple | Nerd |
| --- | --- | --- |
| Stats cache | Usage summary | Derived usage metrics with provenance |
| Telemetry | Activity data | Redacted telemetry records and state |
| File backup | File history | Tracked backup and restore metadata |
| Shell snapshot | Captured shell | Bounded, redacted shell snapshot |

## 6. Files touched

- `src-tauri/src/files/` and `src-tauri/src/commands/maintenance/` — add readers for stats, telemetry, file history, and shell snapshots.
- `src-tauri/src/commands/files.rs` — expose source-aware maintenance commands through the validated boundary.
- `src-tauri/src/main.rs` — register the Codex maintenance commands.
- `frontend/src/shared/types/api/` — add usage, telemetry, file-history, and snapshot types.
- `frontend/src/renderer/api/tauri/domain/maintenance.ts` and `snapshots.ts` — map the typed API.
- `frontend/src/renderer/components/maintenance/UsageStatsPanel.tsx` — show Codex usage summaries.
- `frontend/src/renderer/components/maintenance/FileHistoryBrowserPanel.tsx` — show tracked files and safe actions.
- `frontend/src/renderer/components/maintenance/ShellSnapshotPanel.tsx` — show redacted snapshots.
- `frontend/src/renderer/components/maintenance/MaintenanceView.tsx` — add Codex scope and states.

## 7. Tasks (ordered)

1. Add source-aware readers for `stats-cache.json` and `telemetry/` with bounded scans and redaction.
2. Derive usage summaries without inventing cost or token values that are not present in the source.
3. Add telemetry status and time-range views without exposing raw sensitive payloads.
4. Add File History listing with server-side path resolution and explicit local-machine scope.
5. Add Save as… and Restore to original… review states, including a confirmed pre-restore backup step.
6. Add Shell Snapshot listing/detail with bounded output, command redaction, and no execution path.
7. Add refresh, stale, missing, and permission-denied states to the maintenance view.
8. Add fixture tests for malformed files, path traversal, redaction, restore conflicts, and partial snapshots.

## 8. Verification / acceptance

- Usage shows an accurate period, source, and available metrics; missing metrics are labeled unavailable.
- Telemetry is redacted before it crosses the Tauri API and does not require a live network connection.
- File History never accepts an arbitrary renderer path and shows whether a recovery copy exists.
- Restore refuses to proceed when the backup or target resolution fails.
- Shell Snapshots are read-only and never launch a shell command.
- Claude maintenance data remains unchanged when Codex is selected.
- `bun run typecheck`, `bun run test`, `bun run test:rust`, and `bun run qa` pass.

## 9. Accessibility

- Usage cards and maintenance sections expose their period, source, and state as text.
- Tables and file lists have real headings, labels, and keyboard-reachable actions.
- Restore and Save as… dialogs announce scope, backup status, and errors before action.
- Long shell output wraps, remains selectable, and does not force horizontal scrolling.

## 10. Dependencies

- CDX-01 root safety and CDX-02 source-aware session context.
- CDX-03/CDX-04 provenance and write/recovery rules.
- Existing maintenance, snapshots, and file-history command contracts.
- A confirmed policy that Codex maintenance writes are always local-machine writes.

## 11. Risks / open questions

- Usage and telemetry formats can change; preserve unknown fields only in safe diagnostics.
- Telemetry may contain prompts, paths, or identifiers; redaction must be tested before every API response.
- Restore currently has a load-bearing backup and native-dialog assumption in the project instructions; do not ship this sprint until both are manually confirmed.
- A connected SSH session must not redirect local Codex maintenance writes to the remote machine.

## 12. References

- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)

## 13. Producer contract status

The grouped reader fixtures are sanitized and fixture-only. This repository does
not pin a Codex producer revision for `stats-cache.json`, `telemetry/`, or
`file-history/`. The implementation therefore treats missing, malformed, and
unknown data as explicit diagnostics or unavailable states. Release support for
those datasets requires a pinned producer/schema contract and a refreshed
fixture matrix.
