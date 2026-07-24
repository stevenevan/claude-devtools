# Sprint 04 — Checkpoint Diff + Export (restore = stretch)

## 1. Goal
Compare two versions of a file-history snapshot and recover a chosen version. **Guaranteed:**
version-vs-version diff + non-destructive export (copy / save-as). **Stretch (gated):** in-place
restore of a snapshot back to its real file path.

## 2. Gap addressed
Same data as Sprint 03 (`file-history/{uuid}/{hash}@vN`), adding compare + recovery. No diff or
recovery path exists today.

## 3. Backend
- Diff is computed in the frontend from two `read_checkpoint` results (Sprint 03) — no new read
  command needed for the guaranteed path.
- **Non-destructive export** (guaranteed): save-as writes user-chosen destination via the dialog
  plugin (`tauri-plugin-dialog`, already a dependency) — the user picks the path, so no
  root-confinement concern; copy-to-clipboard needs no backend.
- **In-place restore (stretch, gated):** new `restore_checkpoint(session_uuid, file_hash, version)`
  in `src-tauri/src/commands/maintenance/` — a **gated write** (`state.gated(|root| …)`, defined on
  `impl MaintenanceState` in `commands/maintenance/state.rs`) that **trash-backs the current file
  first** via `src-tauri/src/maintenance/trash.rs`, then writes the snapshot bytes to the resolved
  real path. Path resolution: the session JSONL `file-history-snapshot` entry's
  `snapshot.trackedFileBackups` map (`{hash}@vN` → real path). **This map is `{}` in the sample**,
  so restore ships only if the premise-gate below finds a populated map; otherwise it stays a
  follow-up and this sprint delivers export only.

## 4. Frontend
- Extend `frontend/src/renderer/components/maintenance/FileHistoryBrowserPanel.tsx`:
  - Version-vs-version **diff reusing `frontend/src/renderer/components/maintenance/JsonDiffView.tsx`**
    (or its text-diff core) — select two versions of one `{hash}`, render the diff.
  - Export actions: copy-to-clipboard, save-as (dialog).
  - Restore button (only rendered if the stretch ships) behind
    `frontend/src/renderer/components/maintenance/DryRunConfirmDialog.tsx`.

## 5. Tasks (ordered)
1. **Premise gate (Assumption 2):** grep session JSONL for a **non-empty** `trackedFileBackups` and
   inspect its shape. Populated + reversible → restore is in scope. Empty/irreversible → restore is
   dropped to a follow-up; proceed with export only. Record the outcome in this file.
2. Frontend diff (two `read_checkpoint` → `JsonDiffView`) + copy/save-as export.
3. **If gate passed:** `restore_checkpoint` (gated write + trash-back + resolved path) →
   `cargo test restore_checkpoint`; wire the confirm-dialog restore button.

## 6. Verification / acceptance
- `bun run typecheck && bun run test && bun run qa` green.
- Manual (guaranteed): pick two versions → diff renders; save-as writes the chosen version; copy
  yields exact bytes.
- Manual (stretch, if shipped): restore trash-backs the current file, then writes the snapshot;
  `cargo test restore_checkpoint` proves the backup precedes the overwrite.

## 7. Dependencies
Sprint 03 (`read_checkpoint`, the browser panel).

## 8. Drift / risk notes
- **Assumption 2 (unverified):** restore path-mapping. Gated at task 1; export is unaffected either
  way. Never overwrite a file without a trash-backup first.
