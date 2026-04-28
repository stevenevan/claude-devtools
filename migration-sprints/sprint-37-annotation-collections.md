# Sprint 37 — Week of 2026-09-14 | Customization

## Annotation/Bookmark Collections Export/Import

### Deliverables
1. **Export** — selected annotations + bookmarks → single JSON file. New commands `config_export_annotations(session_ids) -> String` and `config_import_annotations(json: String) -> ImportReport` added to existing `config/commands.rs` (annotation backend already lives in the config module — confirmed `config_add_annotation`, `config_update_annotation`, `config_remove_annotation`, `config_get_annotations` in `src-tauri/src/config/commands.rs`).
2. **Import** — merge into existing annotations by `(session_id, target_id, author)`; conflicts surface in dialog (newer timestamp wins per metis directive).
3. `CollectionsPanel.tsx` — manage export/import + collection grouping (named set of annotation ids).

### Files
- `src-tauri/src/config/commands.rs` (add export/import commands next to existing annotation CRUD)
- `src-tauri/src/config/manager.rs` (add `import_annotations(entries, resolution) -> ImportReport`)
- `src-tauri/src/config/types.rs` (add `ImportReport`, optional collection grouping field)
- `src-tauri/src/lib.rs` (register new commands)
- `src/renderer/components/chat/CollectionsPanel.tsx` (new)
- `src/renderer/components/sidebar/AnnotationList.tsx` (add export button)
- `src/renderer/store/slices/annotationSlice.ts`
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Sprint 3 (annotation backend lives in `config/` module)
- Existing `BookmarksPanel.tsx`

### Verification
- `cargo test` conflict resolution prefers newer timestamp
- Manual: round-trip export→delete→import restores byte-identical data
