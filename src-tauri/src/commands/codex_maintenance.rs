//! Source-aware maintenance commands.
//!
//! The renderer receives typed summaries and bounded previews. Filesystem
//! paths used for writes are resolved here and are never accepted from IPC.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::config::root::{self, claude_dir};
use crate::files::{
    checkpoint_origin, checkpoint_recovery, claude_read, codex_inventory, codex_maintenance,
    filehistory_reader,
};
use crate::types::codex_maintenance::{
    CheckpointMutationResult, CheckpointOriginSummary, MaintenanceCapabilityState, MaintenancePage,
    RecoveryCopy, ShellSnapshotDetail, ShellSnapshotItem, SourceCheckpointDetail,
    SourceCheckpointGroup, SourceMaintenanceStatus, TelemetryDetail, TelemetryItem, UsageSummary,
};
use crate::types::source::{Diagnostic, Provenance, SourceKind};

const MAX_PAGE_SIZE: usize = codex_maintenance::MAX_PAGE_SIZE;
const MAX_DETAIL_BYTES: usize = codex_maintenance::MAX_DETAIL_BYTES;
const MAX_SNAPSHOT_BYTES: usize = codex_maintenance::MAX_SNAPSHOT_BYTES;
const MAX_SCAN_ENTRIES: usize = codex_maintenance::MAX_SCAN_ENTRIES;
const MAX_CURSOR_BYTES: usize = codex_maintenance::MAX_CURSOR_BYTES;
const MAX_DIAGNOSTICS: usize = codex_maintenance::MAX_DIAGNOSTICS;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaintenanceCursor {
    version: u8,
    source: SourceKind,
    dataset: String,
    revision: String,
    offset: usize,
}

#[derive(Debug, Clone)]
struct BoundedListing {
    items: Vec<claude_read::FileMeta>,
    scan_limited: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_source_maintenance_status(
    source_kind: SourceKind,
) -> Result<SourceMaintenanceStatus, String> {
    match source_kind {
        SourceKind::Claude => {
            let source = root::get_claude_source_status();
            Ok(SourceMaintenanceStatus {
                source_kind,
                state: source.state,
                label: source.label,
                revision: source.revision,
                capabilities: source.capabilities.maintenance,
                diagnostics: Vec::new(),
            })
        }
        SourceKind::Codex => codex_maintenance::source_status(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_source_usage_summary(source_kind: SourceKind) -> Result<UsageSummary, String> {
    match source_kind {
        SourceKind::Codex => codex_maintenance::read_usage_summary(),
        SourceKind::Claude => read_claude_usage_summary(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_source_telemetry(
    source_kind: SourceKind,
    cursor: Option<String>,
    limit: usize,
) -> Result<MaintenancePage<TelemetryItem>, String> {
    validate_cursor_bytes(cursor.as_deref())?;
    validate_limit(limit)?;
    match source_kind {
        SourceKind::Codex => codex_maintenance::list_telemetry(cursor.as_deref(), limit),
        SourceKind::Claude => list_claude_telemetry(cursor.as_deref(), limit),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_source_telemetry(
    source_kind: SourceKind,
    id: String,
) -> Result<TelemetryDetail, String> {
    validate_component(&id, "telemetry id")?;
    match source_kind {
        SourceKind::Codex => codex_maintenance::read_telemetry(&id),
        SourceKind::Claude => read_claude_telemetry(&id),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_source_file_history(
    source_kind: SourceKind,
    cursor: Option<String>,
    limit: usize,
) -> Result<MaintenancePage<SourceCheckpointGroup>, String> {
    validate_cursor_bytes(cursor.as_deref())?;
    validate_limit(limit)?;
    match source_kind {
        SourceKind::Codex => codex_maintenance::list_file_history(cursor.as_deref(), limit),
        SourceKind::Claude => list_claude_file_history(cursor.as_deref(), limit),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_source_checkpoint(
    source_kind: SourceKind,
    session_uuid: String,
    file_hash: String,
    version: u32,
) -> Result<SourceCheckpointDetail, String> {
    validate_checkpoint_ids(&session_uuid, &file_hash)?;
    match source_kind {
        SourceKind::Codex => codex_maintenance::read_checkpoint(&session_uuid, &file_hash, version),
        SourceKind::Claude => read_claude_checkpoint(&session_uuid, &file_hash, version),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn resolve_source_checkpoint_origins(
    source_kind: SourceKind,
    session_uuid: String,
    file_hashes: Vec<String>,
) -> Result<std::collections::HashMap<String, Option<CheckpointOriginSummary>>, String> {
    validate_component(&session_uuid, "session id")?;
    if file_hashes.len() > MAX_SCAN_ENTRIES {
        return Err("file history origin request is too large".to_string());
    }
    for file_hash in &file_hashes {
        validate_component(file_hash, "file hash")?;
    }
    match source_kind {
        SourceKind::Codex => {
            codex_maintenance::resolve_checkpoint_origins(&session_uuid, &file_hashes)
        }
        SourceKind::Claude => {
            let root = claude_dir()?;
            let mut result = std::collections::HashMap::new();
            for file_hash in file_hashes {
                let origin = checkpoint_origin::resolve_checkpoint_origin(
                    &root.to_string_lossy(),
                    &session_uuid,
                    &file_hash,
                )?
                .and_then(|origin| {
                    let path = PathBuf::from(origin.real_path);
                    validate_restore_origin(&path)
                        .ok()
                        .map(|_| CheckpointOriginSummary {
                            display_path: display_path(&path),
                            backup_time: origin.backup_time,
                            verified: true,
                        })
                });
                result.insert(file_hash, origin);
            }
            Ok(result)
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_source_shell_snapshots(
    source_kind: SourceKind,
    cursor: Option<String>,
    limit: usize,
) -> Result<MaintenancePage<ShellSnapshotItem>, String> {
    validate_cursor_bytes(cursor.as_deref())?;
    validate_limit(limit)?;
    match source_kind {
        SourceKind::Codex => codex_maintenance::list_shell_snapshots(cursor.as_deref(), limit),
        SourceKind::Claude => list_claude_shell_snapshots(cursor.as_deref(), limit),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_source_shell_snapshot(
    source_kind: SourceKind,
    name: String,
) -> Result<ShellSnapshotDetail, String> {
    validate_component(&name, "shell snapshot name")?;
    match source_kind {
        SourceKind::Codex => codex_maintenance::read_shell_snapshot(&name),
        SourceKind::Claude => read_claude_shell_snapshot(&name),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_source_checkpoint_via_dialog(
    source_kind: SourceKind,
    session_uuid: String,
    file_hash: String,
    version: u32,
    app: AppHandle,
) -> Result<CheckpointMutationResult, String> {
    validate_checkpoint_ids(&session_uuid, &file_hash)?;
    ensure_codex_mutation_supported(source_kind)?;
    let bytes = read_checkpoint_bytes(source_kind, &session_uuid, &file_hash, version).map_err(
        |error| format!("save checkpoint failed before write (target unchanged): {error}"),
    )?;
    let dest = choose_checkpoint_path(&app, &file_hash, version, None, "Save checkpoint").map_err(
        |error| format!("save checkpoint failed before write (target unchanged): {error}"),
    )?;
    let Some(dest) = dest else {
        return Ok(CheckpointMutationResult {
            operation: "saveCheckpoint".to_string(),
            state: "cancelled".to_string(),
            target_changed: false,
            target_label: None,
            recovery_id: None,
        });
    };
    write_user_selected_file(&dest, &bytes).map_err(|error| {
        format!("save checkpoint failed before write (target unchanged): {error}")
    })?;
    Ok(CheckpointMutationResult {
        operation: "saveCheckpoint".to_string(),
        state: "written".to_string(),
        target_changed: true,
        target_label: Some(display_path(&dest)),
        recovery_id: None,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn restore_source_checkpoint(
    source_kind: SourceKind,
    session_uuid: String,
    file_hash: String,
    version: u32,
    app: AppHandle,
) -> Result<CheckpointMutationResult, String> {
    validate_checkpoint_ids(&session_uuid, &file_hash)?;
    ensure_codex_mutation_supported(source_kind)?;
    let initial_origin = resolve_origin(source_kind, &session_uuid, &file_hash)
        .map_err(|error| format!("restore checkpoint failed before write (target unchanged): {error}"))?
        .ok_or_else(|| "restore checkpoint failed before write (target unchanged): original path for this checkpoint is unknown".to_string())?;
    let bytes = read_checkpoint_bytes(source_kind, &session_uuid, &file_hash, version).map_err(
        |error| format!("restore checkpoint failed before write (target unchanged): {error}"),
    )?;
    let selected = choose_checkpoint_path(
        &app,
        &file_hash,
        version,
        Some(&initial_origin),
        "Restore checkpoint",
    )
    .map_err(|error| {
        format!("restore checkpoint failed before write (target unchanged): {error}")
    })?;
    let Some(selected) = selected else {
        return Ok(CheckpointMutationResult {
            operation: "restoreCheckpoint".to_string(),
            state: "cancelled".to_string(),
            target_changed: false,
            target_label: None,
            recovery_id: None,
        });
    };
    if selected != initial_origin {
        return Err("restore checkpoint cancelled before write (target unchanged): the selected path did not match the verified origin".to_string());
    }
    let current_origin = resolve_origin(source_kind, &session_uuid, &file_hash)
        .map_err(|error| format!("restore checkpoint cancelled before write (target unchanged): {error}"))?
        .ok_or_else(|| {
            "restore checkpoint cancelled before write (target unchanged): checkpoint origin is no longer verifiable".to_string()
        })?;
    if current_origin != initial_origin {
        return Err("restore checkpoint cancelled before write (target unchanged): checkpoint origin changed; refresh and try again".to_string());
    }

    let recovery = checkpoint_recovery::create_and_write_atomic_if_unchanged(
        source_kind,
        &session_uuid,
        &file_hash,
        version,
        &initial_origin,
        &bytes,
    )
    .map_err(|error| {
        format!(
            "restore checkpoint failed; target change was not verified (refresh before retry): {error}"
        )
    })?;
    Ok(CheckpointMutationResult {
        operation: "restoreCheckpoint".to_string(),
        state: "written".to_string(),
        target_changed: true,
        target_label: Some(display_path(&initial_origin)),
        recovery_id: Some(recovery.id),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_checkpoint_recovery_copies(
    source_kind: SourceKind,
) -> Result<Vec<RecoveryCopy>, String> {
    checkpoint_recovery::list(source_kind)
}

#[tauri::command(rename_all = "camelCase")]
pub fn restore_checkpoint_recovery_copy(
    source_kind: SourceKind,
    id: String,
) -> Result<CheckpointMutationResult, String> {
    validate_component(&id, "recovery copy id")?;
    let metadata = checkpoint_recovery::get(source_kind, &id).map_err(|error| {
        format!("restore recovery copy failed before write (target unchanged): {error}")
    })?;
    let target = resolve_origin(source_kind, &metadata.session_uuid, &metadata.file_hash)
        .map_err(|error| {
            format!("restore recovery copy failed before write (target unchanged): {error}")
        })?
        .ok_or_else(|| {
            "restore recovery copy failed before write (target unchanged): verified origin is unavailable"
                .to_string()
        })?;
    let recovery = checkpoint_recovery::restore(source_kind, &id, &target).map_err(|error| {
        format!("restore recovery copy failed; target change was not verified: {error}")
    })?;
    Ok(CheckpointMutationResult {
        operation: "restoreRecoveryCopy".to_string(),
        state: "written".to_string(),
        target_changed: true,
        target_label: Some(recovery.target_label),
        recovery_id: Some(recovery.id),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_checkpoint_recovery_copy(
    source_kind: SourceKind,
    id: String,
) -> Result<CheckpointMutationResult, String> {
    validate_component(&id, "recovery copy id")?;
    let recovery = checkpoint_recovery::delete(source_kind, &id)
        .map_err(|error| format!("delete recovery copy failed; target unchanged: {error}"))?;
    Ok(CheckpointMutationResult {
        operation: "deleteRecoveryCopy".to_string(),
        state: "deleted".to_string(),
        target_changed: false,
        target_label: Some(recovery.target_label),
        recovery_id: Some(recovery.id),
    })
}

fn read_claude_usage_summary() -> Result<UsageSummary, String> {
    let root = claude_dir()?;
    let revision = root::maintenance_revision(&root, "stats-cache.json");
    let path = Path::new("stats-cache.json");
    if !root.join(path).exists() {
        return Ok(UsageSummary {
            source: SourceKind::Claude,
            state: MaintenanceCapabilityState::Missing,
            period: None,
            turns: None,
            tokens: None,
            cost: None,
            source_file: Some(path.to_string_lossy().into_owned()),
            revision,
            stale: false,
            diagnostics: Vec::new(),
        });
    }
    let value = match read_json_file(&root, path, MAX_DETAIL_BYTES) {
        Ok(value) => value,
        Err(error) => {
            return Ok(UsageSummary {
                source: SourceKind::Claude,
                state: MaintenanceCapabilityState::Unreadable,
                period: None,
                turns: None,
                tokens: None,
                cost: None,
                source_file: Some(path.to_string_lossy().into_owned()),
                revision,
                stale: false,
                diagnostics: vec![Diagnostic::new(
                    "usageUnreadable",
                    format!("cannot read Claude usage cache: {error}"),
                )],
            });
        }
    };
    Ok(UsageSummary {
        source: SourceKind::Claude,
        state: MaintenanceCapabilityState::Available,
        period: find_string(&value, &["period", "window", "range", "dateRange"]),
        turns: find_u64(&value, &["turns", "turnCount", "totalTurns", "requests"]),
        tokens: find_u64(
            &value,
            &["tokens", "totalTokens", "inputTokens", "outputTokens"],
        ),
        cost: find_f64(&value, &["cost", "totalCost", "estimatedCost"]),
        source_file: Some(path.to_string_lossy().into_owned()),
        revision,
        stale: false,
        diagnostics: Vec::new(),
    })
}

fn list_claude_telemetry(
    cursor: Option<&str>,
    limit: usize,
) -> Result<MaintenancePage<TelemetryItem>, String> {
    let limit = validate_limit(limit)?;
    let root = claude_dir()?;
    let revision = dataset_revision(&root, "telemetry");
    let offset = decode_cursor(cursor, SourceKind::Claude, "telemetry", &revision)?;
    let listing = list_claude_files(&root, Path::new("telemetry"), Some("json"))?;
    let page_start = offset.min(listing.items.len());
    let page_end = page_start
        .saturating_add(limit)
        .saturating_add(1)
        .min(listing.items.len());
    let has_more = page_end > page_start.saturating_add(limit);
    let mut diagnostics = Vec::new();
    let mut items = Vec::new();
    for file in listing.items[page_start..page_end].iter().take(limit) {
        let relative = Path::new("telemetry").join(&file.name);
        let (kind, timestamp, status) = match read_json_file(&root, &relative, MAX_DETAIL_BYTES) {
            Ok(value) => (
                find_string(&value, &["kind", "type", "event", "name"]),
                find_string(&value, &["timestamp", "ts", "createdAt", "time"]),
                find_string(&value, &["status", "state", "result"]),
            ),
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "telemetryRecordUnreadable",
                    format!("telemetry record is unavailable: {error}"),
                ));
                (None, None, None)
            }
        };
        items.push(TelemetryItem {
            id: file.name.clone(),
            kind,
            timestamp,
            status,
            size_bytes: file.size_bytes.max(0) as u64,
            mtime: file.mtime,
            redaction: "redacted".to_string(),
            provenance: Provenance {
                source_file: format!("telemetry/{}", file.name),
                line: None,
                archived: false,
            },
        });
    }
    let revision_complete = !revision.starts_with("incomplete-");
    let scan_limited = listing.scan_limited || !revision_complete;
    let has_more = has_more && revision_complete;
    let next_cursor = has_more
        .then(|| {
            encode_cursor(
                SourceKind::Claude,
                "telemetry",
                &revision,
                page_start + limit,
            )
        })
        .transpose()?;
    diagnostics.truncate(MAX_DIAGNOSTICS);
    Ok(MaintenancePage {
        items,
        next_cursor,
        has_more,
        total_matched: (!scan_limited).then_some(listing.items.len()),
        scan_limited,
        diagnostics,
        revision: Some(revision),
    })
}

fn read_claude_telemetry(id: &str) -> Result<TelemetryDetail, String> {
    validate_component(id, "telemetry id")?;
    let root = claude_dir()?;
    let relative = Path::new("telemetry").join(id);
    let value = read_json_file(&root, &relative, MAX_DETAIL_BYTES)?;
    let file = metadata_for_relative(&root, &relative)?;
    let item = TelemetryItem {
        id: id.to_string(),
        kind: find_string(&value, &["kind", "type", "event", "name"]),
        timestamp: find_string(&value, &["timestamp", "ts", "createdAt", "time"]),
        status: find_string(&value, &["status", "state", "result"]),
        size_bytes: file.len(),
        mtime: modified_ms(&file),
        redaction: "redacted".to_string(),
        provenance: Provenance {
            source_file: format!("telemetry/{id}"),
            line: None,
            archived: false,
        },
    };
    Ok(TelemetryDetail {
        item,
        summary: codex_maintenance::safe_fields(&value),
        diagnostics: Vec::new(),
    })
}

fn list_claude_file_history(
    cursor: Option<&str>,
    limit: usize,
) -> Result<MaintenancePage<SourceCheckpointGroup>, String> {
    let limit = validate_limit(limit)?;
    let root = claude_dir()?;
    let revision = dataset_revision(&root, "file-history");
    let offset = decode_cursor(cursor, SourceKind::Claude, "file-history", &revision)?;
    let listing =
        filehistory_reader::list_file_history_bounded(&root.to_string_lossy(), MAX_SCAN_ENTRIES)?;
    let groups = listing.groups;
    let scan_limited = listing.scan_limited;
    let mut diagnostics = Vec::new();
    let mut items = Vec::with_capacity(groups.len());
    for group in groups {
        items.push(SourceCheckpointGroup {
            source: SourceKind::Claude,
            session_uuid: group.session_uuid.clone(),
            file_hash: group.file_hash.clone(),
            versions: group.versions,
            latest_mtime: group.latest_mtime,
            latest_size: group.latest_size,
            origin: None,
            provenance: Provenance {
                source_file: format!("file-history/{}/{}", group.session_uuid, group.file_hash),
                line: None,
                archived: false,
            },
        });
    }
    if scan_limited {
        diagnostics.push(Diagnostic::new(
            "fileHistoryScanLimited",
            "Claude file-history results were capped at the bounded scan limit",
        ));
    }
    page(
        items,
        offset,
        limit,
        SourceKind::Claude,
        "file-history",
        revision,
        scan_limited,
        diagnostics,
    )
}

fn read_claude_checkpoint(
    session_uuid: &str,
    file_hash: &str,
    version: u32,
) -> Result<SourceCheckpointDetail, String> {
    let root = claude_dir()?;
    let bytes = filehistory_reader::read_checkpoint_bytes(
        &root.to_string_lossy(),
        session_uuid,
        file_hash,
        version,
    )?;
    if bytes.len() > MAX_DETAIL_BYTES {
        return Err("checkpoint exceeds the bounded read size".to_string());
    }
    let (content, content_unavailable_reason) = codex_maintenance::safe_checkpoint_preview(&bytes);
    Ok(SourceCheckpointDetail {
        source: SourceKind::Claude,
        session_uuid: session_uuid.to_string(),
        file_hash: file_hash.to_string(),
        version,
        content,
        content_unavailable_reason,
        byte_size: bytes.len(),
        binary: bytes.iter().any(|byte| *byte == 0) || std::str::from_utf8(&bytes).is_err(),
        provenance: Provenance {
            source_file: format!("file-history/{session_uuid}/{file_hash}@v{version}"),
            line: None,
            archived: false,
        },
        revision: root::maintenance_revision(&root, "file-history"),
        diagnostics: Vec::new(),
    })
}

fn list_claude_shell_snapshots(
    cursor: Option<&str>,
    limit: usize,
) -> Result<MaintenancePage<ShellSnapshotItem>, String> {
    let limit = validate_limit(limit)?;
    let root = claude_dir()?;
    let revision = dataset_revision(&root, "shell-snapshots");
    let offset = decode_cursor(cursor, SourceKind::Claude, "shell-snapshots", &revision)?;
    let listing = list_claude_files(&root, Path::new("shell-snapshots"), Some("sh"))?;
    let items = listing
        .items
        .into_iter()
        .map(|file| ShellSnapshotItem {
            session_id: file
                .name
                .split('.')
                .next()
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            name: file.name.clone(),
            size_bytes: file.size_bytes.max(0) as u64,
            mtime: file.mtime,
            redaction: "redacted".to_string(),
            provenance: Provenance {
                source_file: format!("shell-snapshots/{}", file.name),
                line: None,
                archived: false,
            },
        })
        .collect::<Vec<_>>();
    page(
        items,
        offset,
        limit,
        SourceKind::Claude,
        "shell-snapshots",
        revision,
        listing.scan_limited,
        Vec::new(),
    )
}

fn read_claude_shell_snapshot(name: &str) -> Result<ShellSnapshotDetail, String> {
    validate_component(name, "shell snapshot name")?;
    let root = claude_dir()?;
    let relative = Path::new("shell-snapshots").join(name);
    let metadata = metadata_for_relative(&root, &relative)?;
    let item = ShellSnapshotItem {
        session_id: name
            .split('.')
            .next()
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        name: name.to_string(),
        size_bytes: metadata.len(),
        mtime: modified_ms(&metadata),
        redaction: "redacted".to_string(),
        provenance: Provenance {
            source_file: format!("shell-snapshots/{name}"),
            line: None,
            archived: false,
        },
    };
    let (bytes, truncated) = codex_inventory::read_bounded_bytes(
        &codex_inventory::confined_path(&root, &relative)
            .map_err(|error| format!("cannot read shell snapshot: {error}"))?,
        MAX_SNAPSHOT_BYTES,
    )
    .map_err(|error| format!("cannot read shell snapshot: {error}"))?;
    let (content, unavailable_reason) = match String::from_utf8(bytes) {
        Ok(text) if truncated => (
            None,
            Some("This shell snapshot is truncated and is not shown".to_string()),
        ),
        Ok(text) if text.starts_with("# Snapshot file") || text.starts_with("#!") => {
            match codex_maintenance::redact_shell_snapshot(&text) {
                Some(content) => (Some(content), None),
                None => (
                    None,
                    Some("This shell snapshot contains unsafe constructs".to_string()),
                ),
            }
        }
        Ok(_) => (
            None,
            Some("This shell snapshot format is not supported for safe display".to_string()),
        ),
        Err(_) => (
            None,
            Some("This shell snapshot is not valid UTF-8".to_string()),
        ),
    };
    Ok(ShellSnapshotDetail {
        item,
        content,
        truncated,
        unavailable_reason,
        diagnostics: Vec::new(),
    })
}

fn read_checkpoint_bytes(
    source_kind: SourceKind,
    session_uuid: &str,
    file_hash: &str,
    version: u32,
) -> Result<Vec<u8>, String> {
    match source_kind {
        SourceKind::Codex => {
            codex_maintenance::read_checkpoint_bytes(session_uuid, file_hash, version)
        }
        SourceKind::Claude => {
            let root = claude_dir()?;
            let bytes = filehistory_reader::read_checkpoint_bytes(
                &root.to_string_lossy(),
                session_uuid,
                file_hash,
                version,
            )?;
            if bytes.len() > MAX_DETAIL_BYTES {
                return Err("checkpoint exceeds the bounded read size".to_string());
            }
            Ok(bytes)
        }
    }
}

fn resolve_origin(
    source_kind: SourceKind,
    session_uuid: &str,
    file_hash: &str,
) -> Result<Option<PathBuf>, String> {
    match source_kind {
        SourceKind::Codex => Ok(codex_maintenance::resolve_checkpoint_origin_path(
            session_uuid,
            file_hash,
        )?
        .map(|(path, _)| path)),
        SourceKind::Claude => {
            let root = claude_dir()?;
            let origin = checkpoint_origin::resolve_checkpoint_origin(
                &root.to_string_lossy(),
                session_uuid,
                file_hash,
            )?
            .map(|origin| PathBuf::from(origin.real_path));
            Ok(origin.filter(|path| validate_restore_origin(path).is_ok()))
        }
    }
}

fn choose_checkpoint_path(
    app: &AppHandle,
    file_hash: &str,
    version: u32,
    aim: Option<&Path>,
    title: &str,
) -> Result<Option<PathBuf>, String> {
    let mut builder = app.dialog().file();
    match aim.and_then(|path| path.parent().zip(path.file_name())) {
        Some((parent, name)) => {
            builder = builder
                .set_directory(parent)
                .set_file_name(name.to_string_lossy());
        }
        None => builder = builder.set_file_name(format!("{file_hash}@v{version}")),
    }
    let Some(file_path) = builder.set_title(title).blocking_save_file() else {
        return Ok(None);
    };
    file_path
        .into_path()
        .map(Some)
        .map_err(|error| format!("resolve selected checkpoint path: {error}"))
}

fn write_user_selected_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    validate_write_path(path)?;
    let existing_mode = selected_file_mode(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "selected save path has no parent directory".to_string())?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "selected save path has an invalid filename".to_string())?;
    let temporary = parent.join(format!(".{name}.codex-save.tmp"));
    if let Ok(metadata) = fs::symlink_metadata(&temporary) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("selected save temporary path is invalid".to_string());
        }
        fs::remove_file(&temporary)
            .map_err(|error| format!("remove selected save temporary path: {error}"))?;
    }
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("create selected save temporary file: {error}"))?;
        set_selected_file_mode(&file, existing_mode)?;
        file.write_all(bytes)
            .map_err(|error| format!("write selected save temporary file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("sync selected save temporary file: {error}"))?;
        drop(file);
        validate_write_path(path)?;
        fs::rename(&temporary, path).map_err(|error| format!("replace selected save path: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn selected_file_mode(path: &Path) -> Result<Option<u32>, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata.permissions().mode() & 0o777,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0o600,
            Err(error) => return Err(format!("inspect selected save file mode: {error}")),
        };
        return Ok(Some(mode));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(None)
    }
}

fn set_selected_file_mode(file: &fs::File, mode: Option<u32>) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(mode.unwrap_or(0o600)))
            .map_err(|error| format!("set selected save file mode: {error}"))?;
    }
    #[cfg(not(unix))]
    {
        let _ = (file, mode);
    }
    Ok(())
}

fn validate_write_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| component == Component::ParentDir)
    {
        return Err("selected save path must be absolute and without traversal".to_string());
    }
    let mut component_path = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir | Component::Prefix(_) => component_path.push(component.as_os_str()),
            Component::Normal(name) => {
                component_path.push(name);
                match fs::symlink_metadata(&component_path) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        return Err("selected save path contains a symlink component".to_string())
                    }
                    Ok(_) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => {
                        return Err(format!("inspect selected save path component: {error}"))
                    }
                }
            }
            Component::CurDir => {}
            Component::ParentDir => unreachable!(),
        }
    }
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("selected save path is not a regular file".to_string());
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| "selected save path has no parent directory".to_string())?;
    let metadata = fs::symlink_metadata(parent)
        .map_err(|error| format!("inspect selected save directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("selected save directory is not a regular directory".to_string());
    }
    Ok(())
}

pub(crate) fn validate_restore_origin(path: &Path) -> Result<(), String> {
    validate_write_path(path)?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("inspect verified restore origin: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("verified restore origin is not a regular file".to_string());
    }
    Ok(())
}

fn list_claude_files(
    root: &Path,
    relative_dir: &Path,
    extension: Option<&str>,
) -> Result<BoundedListing, String> {
    let candidate = root.join(relative_dir);
    match fs::symlink_metadata(&candidate) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("maintenance directory is a symlink".to_string())
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err("maintenance path is not a directory".to_string())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BoundedListing {
                items: Vec::new(),
                scan_limited: false,
            });
        }
        Err(error) => return Err(format!("inspect maintenance directory: {error}")),
    }
    let dir = codex_inventory::confined_path(root, relative_dir)
        .map_err(|error| format!("maintenance directory is not safe: {error}"))?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) => return Err(format!("cannot read maintenance directory: {error}")),
    };
    let mut items = Vec::new();
    let mut scan_limited = false;
    let mut visited_entries = 0usize;
    let mut scanned_bytes = 0usize;
    for entry in entries {
        visited_entries = visited_entries.saturating_add(1);
        if visited_entries > MAX_SCAN_ENTRIES {
            scan_limited = true;
            break;
        }
        let entry = entry.map_err(|error| format!("read maintenance entry: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| format!("inspect maintenance entry: {error}"))?;
        scanned_bytes = scanned_bytes.saturating_add(metadata.len() as usize);
        if scanned_bytes > codex_maintenance::MAX_SCAN_BYTES {
            scan_limited = true;
            break;
        }
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        if extension.is_some_and(|expected| {
            entry.path().extension().and_then(|value| value.to_str()) != Some(expected)
        }) {
            continue;
        }
        items.push(claude_read::FileMeta {
            name,
            size_bytes: metadata.len() as i64,
            mtime: modified_ms(&metadata),
        });
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(BoundedListing {
        items,
        scan_limited,
    })
}

fn read_json_file(root: &Path, relative: &Path, max_bytes: usize) -> Result<Value, String> {
    let bounded = codex_inventory::read_bounded_relative(root, relative, max_bytes)
        .map_err(|error| format!("read {}: {error}", relative.display()))?;
    if bounded.truncated {
        return Err(format!(
            "{} exceeds the bounded read size",
            relative.display()
        ));
    }
    serde_json::from_str(&bounded.text)
        .map_err(|error| format!("parse {}: {error}", relative.display()))
}

fn metadata_for_relative(root: &Path, relative: &Path) -> Result<fs::Metadata, String> {
    let path = codex_inventory::confined_path(root, relative)
        .map_err(|error| format!("inspect {}: {error}", relative.display()))?;
    fs::symlink_metadata(path).map_err(|error| format!("inspect {}: {error}", relative.display()))
}

fn page<T: Clone>(
    items: Vec<T>,
    offset: usize,
    limit: usize,
    source: SourceKind,
    dataset: &str,
    revision: String,
    scan_limited: bool,
    mut diagnostics: Vec<Diagnostic>,
) -> Result<MaintenancePage<T>, String> {
    let page_start = offset.min(items.len());
    let page_end = page_start.saturating_add(limit).min(items.len());
    let revision_complete = !revision.starts_with("incomplete-");
    let has_more = page_end < items.len() && revision_complete;
    let next_cursor = has_more.then(|| encode_cursor(source, dataset, &revision, page_end));
    let scan_limited = scan_limited || !revision_complete;
    diagnostics.truncate(MAX_DIAGNOSTICS);
    Ok(MaintenancePage {
        items: items[page_start..page_end].to_vec(),
        next_cursor: next_cursor.transpose()?,
        has_more,
        total_matched: (!scan_limited).then_some(items.len()),
        scan_limited,
        diagnostics,
        revision: Some(revision),
    })
}

fn validate_limit(limit: usize) -> Result<usize, String> {
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(format!("limit must be between 1 and {MAX_PAGE_SIZE}"));
    }
    Ok(limit)
}

fn validate_cursor_bytes(cursor: Option<&str>) -> Result<(), String> {
    if cursor.is_some_and(|value| value.len() > MAX_CURSOR_BYTES) {
        return Err("maintenance cursor is too large".to_string());
    }
    Ok(())
}

fn validate_checkpoint_ids(session_uuid: &str, file_hash: &str) -> Result<(), String> {
    validate_component(session_uuid, "session id")?;
    validate_component(file_hash, "file hash")
}

fn ensure_codex_mutation_supported(source_kind: SourceKind) -> Result<(), String> {
    if source_kind == SourceKind::Codex {
        return Err(
            "Codex checkpoint Save as and Restore are unavailable until the producer and origin contracts are pinned"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_component(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > codex_maintenance::MAX_ID_BYTES
        || value.contains('/')
        || value.contains('\\')
        || value == "."
        || value == ".."
        || value.contains('\0')
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(())
}

fn dataset_revision(root: &Path, dataset: &str) -> String {
    root::maintenance_revision(root, dataset).unwrap_or_else(|| "missing".to_string())
}

fn encode_cursor(
    source: SourceKind,
    dataset: &str,
    revision: &str,
    offset: usize,
) -> Result<String, String> {
    let cursor = MaintenanceCursor {
        version: 1,
        source,
        dataset: dataset.to_string(),
        revision: revision.to_string(),
        offset,
    };
    serde_json::to_vec(&cursor)
        .map_err(|error| format!("encode maintenance cursor: {error}"))
        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_cursor(
    encoded: Option<&str>,
    source: SourceKind,
    dataset: &str,
    revision: &str,
) -> Result<usize, String> {
    let Some(encoded) = encoded else {
        return Ok(0);
    };
    if revision.starts_with("incomplete-") {
        return Err("maintenance cursor is stale; refresh the source".to_string());
    }
    if encoded.len() > MAX_CURSOR_BYTES {
        return Err("maintenance cursor is too large".to_string());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "maintenance cursor is invalid".to_string())?;
    let cursor: MaintenanceCursor =
        serde_json::from_slice(&bytes).map_err(|_| "maintenance cursor is invalid".to_string())?;
    if cursor.version != 1
        || cursor.source != source
        || cursor.dataset != dataset
        || cursor.revision != revision
    {
        return Err("maintenance cursor is stale; refresh the source".to_string());
    }
    Ok(cursor.offset)
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .map(|value| bounded_display(value, 256))
    })
}

fn find_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object.get(*key).and_then(|value| match value {
            Value::Number(value) => value.as_u64(),
            Value::String(value) => value.parse::<u64>().ok(),
            _ => None,
        })
    })
}

fn find_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object.get(*key).and_then(|value| match value {
            Value::Number(value) => value.as_f64(),
            Value::String(value) => value.parse::<f64>().ok(),
            _ => None,
        })
    })
}

fn bounded_display(value: &str, max_bytes: usize) -> String {
    let mut result = String::new();
    for character in value.chars().filter(|character| !character.is_control()) {
        if result.len() + character.len_utf8() > max_bytes {
            break;
        }
        result.push(character);
    }
    result
}

fn display_path(path: &Path) -> String {
    if let Ok(home) = root::home_dir() {
        if let Ok(relative) = path.strip_prefix(home) {
            return format!("~/{}", relative.to_string_lossy().replace('\\', "/"));
        }
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("…/{name}"))
        .unwrap_or_else(|| "(path unavailable)".to_string())
}

fn modified_ms(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
