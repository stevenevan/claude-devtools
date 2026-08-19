//! Bounded, read-only inspection of Codex maintenance artifacts.
//!
//! This module deliberately exposes summaries and safe previews only. It does
//! not return arbitrary JSON, accepts no renderer filesystem path, and never
//! executes shell snapshot content.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::root;
use crate::files::codex_inventory;
use crate::files::codex_redaction;
use crate::types::codex_maintenance::{
    CheckpointOriginSummary, MaintenanceCapabilities, MaintenanceCapabilityState, MaintenancePage,
    SafeField, ShellSnapshotDetail, ShellSnapshotItem, SourceCheckpointDetail,
    SourceCheckpointGroup, SourceMaintenanceStatus, TelemetryDetail, TelemetryItem, UsageSummary,
};
use crate::types::source::{Diagnostic, Provenance, SourceKind};

pub const MAX_PAGE_SIZE: usize = 100;
pub const MAX_DETAIL_BYTES: usize = 256 * 1024;
pub const MAX_SNAPSHOT_BYTES: usize = 128 * 1024;
pub const MAX_SCAN_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_SCAN_ENTRIES: usize = 5_000;
pub const MAX_DIAGNOSTICS: usize = 100;
pub const MAX_CURSOR_BYTES: usize = 2_048;
pub const MAX_ID_BYTES: usize = 512;

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
struct BoundedBytes {
    bytes: Vec<u8>,
    truncated: bool,
}

pub fn source_status() -> Result<SourceMaintenanceStatus, String> {
    let status = root::get_codex_source_status();
    let codex_root = root::codex_dir().ok();
    let capabilities = root::maintenance_capabilities(codex_root.as_deref());
    Ok(SourceMaintenanceStatus {
        source_kind: SourceKind::Codex,
        state: status.state,
        label: status.label,
        revision: status.revision,
        capabilities,
        diagnostics: Vec::new(),
    })
}

pub fn capabilities(root_path: Option<&Path>) -> MaintenanceCapabilities {
    root::maintenance_capabilities(root_path)
}

pub fn read_usage_summary() -> Result<UsageSummary, String> {
    let codex_root = root::codex_dir()?;
    let revision = root::maintenance_revision(&codex_root, "stats-cache.json");
    let path = codex_root.join("stats-cache.json");
    let mut diagnostics = Vec::new();
    let bytes = match read_file_bytes(&path, MAX_DETAIL_BYTES) {
        Ok(bytes) if !bytes.truncated => bytes.bytes,
        Ok(_) => {
            diagnostics.push(Diagnostic::new(
                "usageTooLarge",
                "Codex usage cache exceeds the bounded read size",
            ));
            return Ok(UsageSummary {
                source: SourceKind::Codex,
                state: MaintenanceCapabilityState::Unreadable,
                period: None,
                turns: None,
                tokens: None,
                cost: None,
                source_file: Some("stats-cache.json".to_string()),
                revision,
                stale: false,
                diagnostics,
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(UsageSummary {
                source: SourceKind::Codex,
                state: MaintenanceCapabilityState::Missing,
                period: None,
                turns: None,
                tokens: None,
                cost: None,
                source_file: Some("stats-cache.json".to_string()),
                revision,
                stale: false,
                diagnostics,
            });
        }
        Err(error) => {
            return Ok(UsageSummary {
                source: SourceKind::Codex,
                state: MaintenanceCapabilityState::Unreadable,
                period: None,
                turns: None,
                tokens: None,
                cost: None,
                source_file: Some("stats-cache.json".to_string()),
                revision,
                stale: false,
                diagnostics: vec![Diagnostic::new(
                    "usageUnreadable",
                    format!("cannot read Codex usage cache: {error}"),
                )],
            });
        }
    };

    let value = match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) => value,
        Err(error) => {
            diagnostics.push(Diagnostic::new(
                "usageInvalidJson",
                format!("Codex usage cache is not valid JSON: {error}"),
            ));
            return Ok(UsageSummary {
                source: SourceKind::Codex,
                state: MaintenanceCapabilityState::Unreadable,
                period: None,
                turns: None,
                tokens: None,
                cost: None,
                source_file: Some("stats-cache.json".to_string()),
                revision,
                stale: false,
                diagnostics,
            });
        }
    };
    let period = find_string(&value, &["period", "window", "range", "dateRange"]);
    let turns = find_u64(&value, &["turns", "turnCount", "totalTurns", "requests"]);
    let tokens = find_u64(
        &value,
        &["tokens", "totalTokens", "inputTokens", "outputTokens"],
    );
    let cost = find_f64(&value, &["cost", "totalCost", "estimatedCost"]);
    Ok(UsageSummary {
        source: SourceKind::Codex,
        state: MaintenanceCapabilityState::Available,
        period,
        turns,
        tokens,
        cost,
        source_file: Some("stats-cache.json".to_string()),
        revision,
        stale: false,
        diagnostics,
    })
}

pub fn list_telemetry(
    cursor: Option<&str>,
    limit: usize,
) -> Result<MaintenancePage<TelemetryItem>, String> {
    let limit = validate_limit(limit)?;
    let codex_root = root::codex_dir()?;
    let revision = dataset_revision(&codex_root, "telemetry");
    let offset = decode_cursor(cursor, "telemetry", &revision)?;
    let dir = codex_root.join("telemetry");
    let (paths, mut diagnostics, scan_limited) = list_regular_files(&dir, MAX_SCAN_ENTRIES)?;
    let mut items = Vec::new();
    let total_matched = (!scan_limited).then_some(paths.len());
    let mut next_offset = offset;
    let mut has_more = false;
    for (index, path) in paths.iter().enumerate().skip(offset).take(limit + 1) {
        if index >= offset.saturating_add(limit) {
            has_more = true;
            break;
        }
        next_offset = index.saturating_add(1);
        let id = relative_label(&dir, &path);
        let source_file = relative_label(&codex_root, &path);
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "telemetryMetadataUnreadable",
                    format!("skipped telemetry metadata: {error}"),
                ));
                continue;
            }
        };
        let (kind, timestamp, status) = match read_json_value(path, MAX_DETAIL_BYTES) {
            Ok(Some(value)) => (
                find_string(&value, &["kind", "type", "event", "name"]),
                find_string(&value, &["timestamp", "ts", "createdAt", "time"]),
                find_string(&value, &["status", "state", "result"]),
            ),
            Ok(None) => (None, None, None),
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "telemetryRecordUnreadable",
                    format!("telemetry record is unavailable: {error}"),
                ));
                (None, None, None)
            }
        };
        items.push(TelemetryItem {
            id,
            kind,
            timestamp,
            status,
            size_bytes: metadata.len(),
            mtime: modified_ms(&metadata),
            redaction: "redacted".to_string(),
            provenance: Provenance {
                source_file,
                line: None,
                archived: false,
            },
        });
    }
    page_window(
        items,
        next_offset,
        has_more,
        total_matched,
        "telemetry",
        revision,
        scan_limited,
        diagnostics,
    )
}

pub fn read_telemetry(id: &str) -> Result<TelemetryDetail, String> {
    validate_relative_id(id)?;
    let codex_root = root::codex_dir()?;
    let relative = Path::new("telemetry").join(id);
    let path = codex_inventory::confined_path(&codex_root, &relative)
        .map_err(|error| format!("telemetry file is not safe: {error}"))?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("cannot inspect telemetry record {id}: {error}"))?;
    let item = telemetry_item_from_path(&codex_root, &path, metadata)?;
    let mut diagnostics = Vec::new();
    let summary = match read_json_value(&path, MAX_DETAIL_BYTES) {
        Ok(Some(value)) => safe_fields(&value),
        Ok(None) => Vec::new(),
        Err(error) => {
            diagnostics.push(Diagnostic::new(
                "telemetryRecordInvalid",
                format!("cannot parse telemetry record: {error}"),
            ));
            Vec::new()
        }
    };
    Ok(TelemetryDetail {
        item,
        summary,
        diagnostics,
    })
}

pub fn list_file_history(
    cursor: Option<&str>,
    limit: usize,
) -> Result<MaintenancePage<SourceCheckpointGroup>, String> {
    let limit = validate_limit(limit)?;
    let codex_root = root::codex_dir()?;
    let revision = dataset_revision(&codex_root, "file-history");
    let offset = decode_cursor(cursor, "file-history", &revision)?;
    let history_dir = codex_root.join("file-history");
    let (groups, diagnostics, scan_limited) = collect_checkpoint_groups(&history_dir)?;
    let total_matched = (!scan_limited).then_some(groups.len());
    let mut items = Vec::new();
    let mut next_offset = offset;
    let mut has_more = false;
    for (index, group) in groups.iter().enumerate().skip(offset).take(limit + 1) {
        if index >= offset.saturating_add(limit) {
            has_more = true;
            break;
        }
        next_offset = index.saturating_add(1);
        items.push(SourceCheckpointGroup {
            source: SourceKind::Codex,
            session_uuid: group.session_uuid.clone(),
            file_hash: group.file_hash.clone(),
            versions: group.versions.clone(),
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
    page_window(
        items,
        next_offset,
        has_more,
        total_matched,
        "file-history",
        revision,
        scan_limited,
        diagnostics,
    )
}

pub fn read_checkpoint(
    session_uuid: &str,
    file_hash: &str,
    version: u32,
) -> Result<SourceCheckpointDetail, String> {
    let codex_root = root::codex_dir()?;
    let bytes = read_checkpoint_bytes(session_uuid, file_hash, version)?;
    let (content, content_unavailable_reason) = safe_checkpoint_preview(&bytes);
    Ok(SourceCheckpointDetail {
        source: SourceKind::Codex,
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
        revision: root::maintenance_revision(&codex_root, "file-history"),
        diagnostics: Vec::new(),
    })
}

pub(crate) fn read_checkpoint_bytes(
    session_uuid: &str,
    file_hash: &str,
    version: u32,
) -> Result<Vec<u8>, String> {
    validate_checkpoint_ids(session_uuid, file_hash)?;
    let codex_root = root::codex_dir()?;
    let relative = Path::new("file-history")
        .join(session_uuid)
        .join(format!("{file_hash}@v{version}"));
    let path = codex_inventory::confined_path(&codex_root, &relative)
        .map_err(|error| format!("checkpoint is not safe: {error}"))?;
    let bounded = read_file_bytes(&path, MAX_DETAIL_BYTES)
        .map_err(|error| format!("cannot read checkpoint: {error}"))?;
    if bounded.truncated {
        return Err("checkpoint exceeds the bounded read size".to_string());
    }
    Ok(bounded.bytes)
}

pub(crate) fn resolve_checkpoint_origin_path(
    session_uuid: &str,
    file_hash: &str,
) -> Result<Option<(PathBuf, Option<String>)>, String> {
    validate_checkpoint_ids(session_uuid, file_hash)?;
    // Codex session JSONL currently has no pinned, independently trusted origin
    // contract. Never turn its cwd/realParentDir fields into a restore target.
    Ok(None)
}

pub fn resolve_checkpoint_origins(
    session_uuid: &str,
    file_hashes: &[String],
) -> Result<HashMap<String, Option<CheckpointOriginSummary>>, String> {
    validate_session_id(session_uuid)?;
    if file_hashes.len() > MAX_SCAN_ENTRIES {
        return Err("file history origin request is too large".to_string());
    }
    for file_hash in file_hashes {
        validate_file_hash(file_hash)?;
    }
    // Keep the read-only browser available, but fail closed for origin display
    // and Restore until Codex publishes a pinned producer/schema contract.
    Ok(file_hashes
        .iter()
        .cloned()
        .map(|file_hash| (file_hash, None))
        .collect())
}

pub fn list_shell_snapshots(
    cursor: Option<&str>,
    limit: usize,
) -> Result<MaintenancePage<ShellSnapshotItem>, String> {
    let limit = validate_limit(limit)?;
    let codex_root = root::codex_dir()?;
    let revision = dataset_revision(&codex_root, "shell_snapshots");
    let offset = decode_cursor(cursor, "shell_snapshots", &revision)?;
    let dir = codex_root.join("shell_snapshots");
    let (paths, mut diagnostics, scan_limited) = list_regular_files(&dir, MAX_SCAN_ENTRIES)?;
    let mut items = Vec::new();
    let total_matched = (!scan_limited).then_some(paths.len());
    let mut next_offset = offset;
    let mut has_more = false;
    for (index, path) in paths.iter().enumerate().skip(offset).take(limit + 1) {
        if index >= offset.saturating_add(limit) {
            has_more = true;
            break;
        }
        next_offset = index.saturating_add(1);
        match shell_item_from_path(&codex_root, path) {
            Ok(item) => items.push(item),
            Err(error) => diagnostics.push(Diagnostic::new(
                "shellSnapshotUnreadable",
                format!("skipped shell snapshot: {error}"),
            )),
        }
    }
    page_window(
        items,
        next_offset,
        has_more,
        total_matched,
        "shell_snapshots",
        revision,
        scan_limited,
        diagnostics,
    )
}

pub fn read_shell_snapshot(name: &str) -> Result<ShellSnapshotDetail, String> {
    validate_component(name, "shell snapshot name")?;
    let codex_root = root::codex_dir()?;
    let relative = Path::new("shell_snapshots").join(name);
    let path = codex_inventory::confined_path(&codex_root, &relative)
        .map_err(|error| format!("shell snapshot is not safe: {error}"))?;
    let item = shell_item_from_path(&codex_root, &path)?;
    let bounded = read_file_bytes(&path, MAX_SNAPSHOT_BYTES)
        .map_err(|error| format!("cannot read shell snapshot: {error}"))?;
    let (content, unavailable_reason) = match String::from_utf8(bounded.bytes) {
        Ok(text) if bounded.truncated => (
            None,
            Some("This shell snapshot is truncated and is not shown".to_string()),
        ),
        Ok(text) if text.starts_with("# Snapshot file") || text.starts_with("#!") => {
            match redact_shell_snapshot(&text) {
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
        truncated: bounded.truncated,
        unavailable_reason,
        diagnostics: Vec::new(),
    })
}

fn collect_checkpoint_groups(
    history_dir: &Path,
) -> Result<(Vec<CheckpointGroupInternal>, Vec<Diagnostic>, bool), String> {
    let mut diagnostics = Vec::new();
    let mut scan_limited = false;
    match fs::symlink_metadata(history_dir) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Codex file history directory is a symlink".to_string())
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err("Codex file history path is not a directory".to_string())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), Vec::new(), false))
        }
        Err(error) => return Err(format!("cannot inspect Codex file history: {error}")),
    }
    let entries = match fs::read_dir(history_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), diagnostics, false));
        }
        Err(error) => return Err(format!("cannot read Codex file history: {error}")),
    };
    let mut sessions = Vec::new();
    let mut scanned_entries = 0usize;
    let mut scanned_bytes = 0usize;
    for entry in entries {
        scanned_entries = scanned_entries.saturating_add(1);
        if scanned_entries > MAX_SCAN_ENTRIES {
            scan_limited = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "fileHistoryEntryUnreadable",
                    format!("skipped a file-history entry: {error}"),
                ));
                continue;
            }
        };
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        sessions.push(entry);
    }
    sessions.sort_by_key(|entry| entry.file_name());
    let mut groups = BTreeMap::<String, Vec<(u32, i64, i64)>>::new();
    'sessions: for session in sessions {
        let session_uuid = session.file_name().to_string_lossy().into_owned();
        if validate_session_id(&session_uuid).is_err() {
            diagnostics.push(Diagnostic::new(
                "invalidFileHistorySession",
                "Skipped a file-history directory with an unsafe identifier",
            ));
            continue;
        }
        let leaf_entries = match fs::read_dir(session.path()) {
            Ok(entries) => entries,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "fileHistorySessionUnreadable",
                    format!("cannot read a file-history session: {error}"),
                ));
                continue;
            }
        };
        for leaf in leaf_entries {
            scanned_entries = scanned_entries.saturating_add(1);
            if scanned_entries > MAX_SCAN_ENTRIES {
                scan_limited = true;
                diagnostics.push(Diagnostic::new(
                    "fileHistoryScanLimited",
                    "File-history scan stopped at the bounded entry limit",
                ));
                break 'sessions;
            }
            let leaf = match leaf {
                Ok(leaf) => leaf,
                Err(_) => continue,
            };
            let metadata = match fs::symlink_metadata(leaf.path()) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            scanned_bytes = scanned_bytes.saturating_add(metadata.len() as usize);
            if scanned_bytes > MAX_SCAN_BYTES {
                scan_limited = true;
                diagnostics.push(Diagnostic::new(
                    "fileHistoryScanLimited",
                    "File-history scan stopped at the bounded metadata budget",
                ));
                break 'sessions;
            }
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                continue;
            }
            let name = leaf.file_name().to_string_lossy().into_owned();
            let Some((hash, version_text)) = name.rsplit_once("@v") else {
                continue;
            };
            if validate_file_hash(hash).is_err() {
                diagnostics.push(Diagnostic::new(
                    "invalidFileHistoryHash",
                    "Skipped a file-history checkpoint with an unsafe identifier",
                ));
                continue;
            }
            let Ok(version) = version_text.parse::<u32>() else {
                continue;
            };
            groups
                .entry(format!("{session_uuid}\0{hash}"))
                .or_default()
                .push((version, modified_ms(&metadata), metadata.len() as i64));
        }
    }
    let mut result = groups
        .into_iter()
        .filter_map(|(key, mut leaves)| {
            let (session_uuid, file_hash) = key.split_once('\0')?;
            leaves.sort_by_key(|leaf| leaf.0);
            let (_, latest_mtime, latest_size) = *leaves.last()?;
            Some(CheckpointGroupInternal {
                session_uuid: session_uuid.to_string(),
                file_hash: file_hash.to_string(),
                versions: leaves.into_iter().map(|leaf| leaf.0).collect(),
                latest_mtime,
                latest_size,
            })
        })
        .collect::<Vec<_>>();
    result.sort_by(|a, b| {
        a.session_uuid
            .cmp(&b.session_uuid)
            .then_with(|| a.file_hash.cmp(&b.file_hash))
    });
    Ok((result, diagnostics, scan_limited))
}

#[derive(Debug, Clone)]
struct CheckpointGroupInternal {
    session_uuid: String,
    file_hash: String,
    versions: Vec<u32>,
    latest_mtime: i64,
    latest_size: i64,
}

fn telemetry_item_from_path(
    root_path: &Path,
    path: &Path,
    metadata: fs::Metadata,
) -> Result<TelemetryItem, String> {
    let id = relative_label(&root_path.join("telemetry"), path);
    let source_file = relative_label(root_path, path);
    let (kind, timestamp, status) = match read_json_value(path, MAX_DETAIL_BYTES) {
        Ok(Some(value)) => (
            find_string(&value, &["kind", "type", "event", "name"]),
            find_string(&value, &["timestamp", "ts", "createdAt", "time"]),
            find_string(&value, &["status", "state", "result"]),
        ),
        _ => (None, None, None),
    };
    Ok(TelemetryItem {
        id,
        kind,
        timestamp,
        status,
        size_bytes: metadata.len(),
        mtime: modified_ms(&metadata),
        redaction: "redacted".to_string(),
        provenance: Provenance {
            source_file,
            line: None,
            archived: false,
        },
    })
}

fn shell_item_from_path(root_path: &Path, path: &Path) -> Result<ShellSnapshotItem, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("shell snapshot is not a regular file".to_string());
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "shell snapshot name is invalid".to_string())?
        .to_string();
    Ok(ShellSnapshotItem {
        session_id: name
            .split('.')
            .next()
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        name: name.clone(),
        size_bytes: metadata.len(),
        mtime: modified_ms(&metadata),
        redaction: "redacted".to_string(),
        provenance: Provenance {
            source_file: relative_label(root_path, path),
            line: None,
            archived: false,
        },
    })
}

fn list_regular_files(
    dir: &Path,
    max_entries: usize,
) -> Result<(Vec<PathBuf>, Vec<Diagnostic>, bool), String> {
    let mut diagnostics = Vec::new();
    match fs::symlink_metadata(dir) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!(
                "maintenance directory {} is a symlink",
                dir.display()
            ));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(format!(
                "maintenance path {} is not a directory",
                dir.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), diagnostics, false));
        }
        Err(error) => return Err(format!("inspect maintenance directory: {error}")),
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), diagnostics, false));
        }
        Err(error) => return Err(format!("cannot read maintenance directory: {error}")),
    };
    let mut paths = Vec::new();
    let mut scan_limited = false;
    let mut visited_entries = 0usize;
    let mut scanned_bytes = 0usize;
    for entry in entries {
        visited_entries = visited_entries.saturating_add(1);
        if visited_entries > max_entries {
            scan_limited = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "maintenanceEntryUnreadable",
                    format!("skipped an unreadable maintenance entry: {error}"),
                ));
                continue;
            }
        };
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) => {
                diagnostics.push(Diagnostic::new(
                    "maintenanceMetadataUnreadable",
                    format!("skipped an unreadable maintenance entry: {error}"),
                ));
                continue;
            }
        };
        scanned_bytes = scanned_bytes.saturating_add(metadata.len() as usize);
        if scanned_bytes > MAX_SCAN_BYTES {
            scan_limited = true;
            diagnostics.push(Diagnostic::new(
                "maintenanceScanLimited",
                "maintenance scan stopped at the bounded metadata budget",
            ));
            break;
        }
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        paths.push(entry.path());
    }
    paths.sort();
    Ok((paths, diagnostics, scan_limited))
}

fn read_json_value(path: &Path, max_bytes: usize) -> Result<Option<Value>, String> {
    let bytes = read_file_bytes(path, max_bytes).map_err(|error| error.to_string())?;
    if bytes.truncated {
        return Err("record exceeds the bounded read size".to_string());
    }
    if bytes.bytes.is_empty() {
        return Ok(None);
    }
    serde_json::from_slice(&bytes.bytes)
        .map(Some)
        .map_err(|error| format!("invalid JSON: {error}"))
}

fn read_file_bytes(path: &Path, max_bytes: usize) -> std::io::Result<BoundedBytes> {
    let (bytes, truncated) = codex_inventory::read_bounded_bytes(path, max_bytes)?;
    Ok(BoundedBytes { bytes, truncated })
}

fn page_window<T>(
    items: Vec<T>,
    next_offset: usize,
    has_more: bool,
    total_matched: Option<usize>,
    dataset: &str,
    revision: String,
    scan_limited: bool,
    mut diagnostics: Vec<Diagnostic>,
) -> Result<MaintenancePage<T>, String> {
    let revision_complete = !revision.starts_with("incomplete-");
    let has_more = has_more && revision_complete;
    let scan_limited = scan_limited || !revision_complete;
    let next_cursor = has_more
        .then(|| encode_cursor(dataset, &revision, next_offset))
        .transpose()?;
    diagnostics.truncate(MAX_DIAGNOSTICS);
    Ok(MaintenancePage {
        items,
        next_cursor,
        has_more,
        total_matched: if scan_limited { None } else { total_matched },
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

fn validate_component(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_ID_BYTES || value.contains('/') || value.contains('\\')
    {
        return Err(format!("{label} is invalid"));
    }
    if value == "." || value == ".." || value.contains('\0') {
        return Err(format!("{label} is invalid"));
    }
    Ok(())
}

fn validate_relative_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || value.contains('\\')
        || value.contains('\0')
    {
        return Err("maintenance id is invalid".to_string());
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("maintenance id is invalid".to_string());
    }
    Ok(())
}

fn validate_session_id(value: &str) -> Result<(), String> {
    validate_component(value, "session id")
}

fn validate_file_hash(value: &str) -> Result<(), String> {
    validate_component(value, "file hash")
}

fn validate_checkpoint_ids(session_uuid: &str, file_hash: &str) -> Result<(), String> {
    validate_session_id(session_uuid)?;
    validate_file_hash(file_hash)
}

fn dataset_revision(root_path: &Path, dataset: &str) -> String {
    root::maintenance_revision(root_path, dataset).unwrap_or_else(|| "missing".to_string())
}

fn encode_cursor(dataset: &str, revision: &str, offset: usize) -> Result<String, String> {
    let cursor = MaintenanceCursor {
        version: 1,
        source: SourceKind::Codex,
        dataset: dataset.to_string(),
        revision: revision.to_string(),
        offset,
    };
    serde_json::to_vec(&cursor)
        .map_err(|error| format!("cannot encode maintenance cursor: {error}"))
        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_cursor(encoded: Option<&str>, dataset: &str, revision: &str) -> Result<usize, String> {
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
        || cursor.source != SourceKind::Codex
        || cursor.dataset != dataset
        || cursor.revision != revision
    {
        return Err("maintenance cursor is stale; refresh the source".to_string());
    }
    Ok(cursor.offset)
}

fn relative_label(root_path: &Path, path: &Path) -> String {
    path.strip_prefix(root_path)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
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
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn safe_fields(value: &Value) -> Vec<SafeField> {
    const ALLOWED: &[&str] = &[
        "kind",
        "type",
        "event",
        "status",
        "state",
        "timestamp",
        "ts",
        "period",
        "count",
        "turns",
        "tokens",
        "inputTokens",
        "outputTokens",
        "cost",
    ];
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    ALLOWED
        .iter()
        .filter_map(|key| {
            let value = object.get(*key)?;
            let safe_value = match value {
                Value::String(value) => safe_string_for_key(key, value)?,
                Value::Number(value) if is_numeric_field(key) => safe_number(key, value)?,
                _ => return None,
            };
            Some(SafeField {
                name: (*key).to_string(),
                value: safe_value,
            })
        })
        .collect()
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .and_then(|value| safe_string_for_key(key, value))
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
            Value::Number(value) => value.as_f64().filter(|value| value.is_finite()),
            Value::String(value) => value.parse::<f64>().ok().filter(|value| value.is_finite()),
            _ => None,
        })
    })
}

pub(crate) fn redact_shell_snapshot(content: &str) -> Option<String> {
    let mut output = Vec::new();
    let mut header_seen = false;
    for (index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if !header_seen && trimmed == "# Snapshot file" {
            header_seen = true;
            output.push("# Snapshot file".to_string());
            continue;
        }
        if !header_seen && trimmed.starts_with("#!") {
            header_seen = true;
            output.push("#! [redacted]".to_string());
            continue;
        }
        if header_seen && index == 1 && trimmed == "# Snapshot file" {
            output.push("# Snapshot file".to_string());
            continue;
        }
        if trimmed.is_empty() {
            output.push(String::new());
            continue;
        }
        let (exported, assignment) = match trimmed.strip_prefix("export ") {
            Some(value) => (true, value),
            None => (false, trimmed),
        };
        let Some((name, _value)) = assignment.split_once('=') else {
            return None;
        };
        if !is_shell_variable_name(name) {
            return None;
        }
        output.push(format!(
            "{}{}=[redacted]",
            if exported { "export " } else { "" },
            name
        ));
    }
    header_seen.then(|| output.join("\n"))
}

fn is_shell_variable_name(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

pub(crate) fn safe_checkpoint_preview(bytes: &[u8]) -> (Option<String>, Option<String>) {
    if bytes.len() > MAX_DETAIL_BYTES {
        return (
            None,
            Some("Checkpoint preview exceeds the bounded display size".to_string()),
        );
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return (
            None,
            Some("Binary checkpoint content is not shown".to_string()),
        );
    };
    if text
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return (
            None,
            Some("Checkpoint contains unsupported control characters".to_string()),
        );
    }
    if contains_sensitive_material(text) {
        return (
            None,
            Some(
                "Checkpoint preview withheld because it may contain sensitive material".to_string(),
            ),
        );
    }
    if text.is_empty() {
        return (Some(String::new()), None);
    }
    (
        None,
        Some(
            "Checkpoint content is withheld because it cannot be proven safe to display"
                .to_string(),
        ),
    )
}

fn safe_string_for_key(key: &str, value: &str) -> Option<String> {
    if value.is_empty() || value.len() > 256 || contains_sensitive_material(value) {
        return None;
    }
    let bounded = codex_redaction::bounded_display(value, 256);
    match key {
        "timestamp" | "ts" | "createdAt" | "time"
            if chrono::DateTime::parse_from_rfc3339(&bounded).is_ok()
                || bounded.parse::<i64>().is_ok() =>
        {
            Some(bounded)
        }
        "period" | "window" | "range" | "dateRange"
            if bounded.len() <= 64
                && bounded.chars().all(|character| {
                    character.is_ascii_alphanumeric() || "_-.:".contains(character)
                })
                && !bounded.contains("..") =>
        {
            Some(bounded)
        }
        "status" | "state" | "result" if is_known_status(&bounded) => Some(bounded),
        "kind" | "type" | "event" | "name" if is_safe_event_label(&bounded) => Some(bounded),
        _ => None,
    }
}

fn is_numeric_field(key: &str) -> bool {
    matches!(
        key,
        "count" | "turns" | "tokens" | "inputTokens" | "outputTokens" | "cost"
    )
}

fn safe_number(key: &str, value: &serde_json::Number) -> Option<String> {
    if key == "cost" {
        return value
            .as_f64()
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(|value| value.to_string());
    }
    value.as_u64().map(|value| value.to_string())
}

fn is_known_status(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "ok" | "success"
            | "succeeded"
            | "complete"
            | "completed"
            | "error"
            | "failed"
            | "failure"
            | "cancelled"
            | "canceled"
            | "pending"
            | "running"
            | "partial"
            | "unknown"
    )
}

fn is_safe_event_label(value: &str) -> bool {
    value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character))
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric())
        && !value.contains("..")
}

fn contains_sensitive_material(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let compact = lower
        .chars()
        .filter(|character| !matches!(character, '_' | '-' | ' ' | '\t'))
        .collect::<String>();
    [
        "apikey",
        "accesstoken",
        "refreshtoken",
        "token",
        "token=",
        "secret",
        "password",
        "credential",
        "authorization",
        "bearer",
        "privatekey",
        "begin openssh private key",
        "begin rsa private key",
        "sk-",
        "ghp_",
    ]
    .iter()
    .any(|marker| lower.contains(marker) || compact.contains(marker))
        || [
            "--token",
            "--api-key",
            "--password",
            "--secret",
            "authorization:",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
}

#[cfg(test)]
#[path = "codex_maintenance_tests.rs"]
mod codex_maintenance_tests;
