//! Read-only browser for `<root>/file-history/{uuid}/{hash}@vN` checkpoint
//! leaves. Listing is done in-module via `std::fs::read_dir`, like
//! `claude_read.rs` — `files/` stays a leaf module and never reaches into
//! `maintenance/`.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::files::claude_read;

/// One (session, file) group of checkpoint versions. `latest_mtime`/
/// `latest_size` describe the highest-version leaf. `mtime` is epoch
/// milliseconds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointGroup {
    pub session_uuid: String,
    pub file_hash: String,
    pub versions: Vec<u32>,
    pub latest_mtime: i64,
    pub latest_size: i64,
}

/// Walks `<root>/file-history/{uuid}/`, parses leaves named `{hash}@vN`, and
/// groups them by `(uuid, hash)` with versions sorted ascending. Skips
/// non-matching entries (e.g. `.DS_Store`). Tolerant: an unreadable uuid dir
/// is skipped, never fails the whole listing. A missing `file-history`
/// directory returns `Ok(vec![])`.
pub fn list_file_history(root: &str) -> Result<Vec<CheckpointGroup>, String> {
    let dir = Path::new(root).join("file-history");
    let Ok(uuid_entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for uuid_entry in uuid_entries.flatten() {
        let session_uuid = uuid_entry.file_name().to_string_lossy().into_owned();
        if session_uuid.is_empty() || session_uuid.starts_with('.') {
            continue;
        }
        let Ok(file_type) = uuid_entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Ok(leaf_entries) = fs::read_dir(uuid_entry.path()) else {
            continue;
        };

        let mut by_hash: BTreeMap<String, Vec<(u32, i64, i64)>> = BTreeMap::new();
        for leaf_entry in leaf_entries.flatten() {
            let leaf_name = leaf_entry.file_name().to_string_lossy().into_owned();
            let Some((hash, version_str)) = leaf_name.rsplit_once("@v") else {
                continue;
            };
            let Ok(version) = version_str.parse::<u32>() else {
                continue;
            };
            let Ok(leaf_file_type) = leaf_entry.file_type() else {
                continue;
            };
            if !leaf_file_type.is_file() {
                continue;
            }
            let Ok(meta) = leaf_entry.metadata() else {
                continue;
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            by_hash
                .entry(hash.to_string())
                .or_default()
                .push((version, mtime, meta.len() as i64));
        }

        for (file_hash, mut leaves) in by_hash {
            leaves.sort_by_key(|(version, _, _)| *version);
            let (_, latest_mtime, latest_size) = *leaves.last().expect("non-empty group");
            out.push(CheckpointGroup {
                session_uuid: session_uuid.clone(),
                file_hash,
                versions: leaves.into_iter().map(|(v, _, _)| v).collect(),
                latest_mtime,
                latest_size,
            });
        }
    }

    out.sort_by(|a, b| {
        a.session_uuid
            .cmp(&b.session_uuid)
            .then_with(|| a.file_hash.cmp(&b.file_hash))
    });
    Ok(out)
}

/// Rejects `session_uuid`/`file_hash` containing `/`, `\`, or `..`. `pub(crate)`
/// so a command can run it BEFORE using either id for anything (e.g. building a
/// save-dialog filename), per CLAUDE.md's validate-at-the-IPC-boundary rule.
pub(crate) fn validate_ids(session_uuid: &str, file_hash: &str) -> Result<(), String> {
    let is_unsafe = |s: &str| s.contains('/') || s.contains('\\') || s.contains("..");
    if is_unsafe(session_uuid) || is_unsafe(file_hash) {
        return Err("files: invalid id".to_string());
    }
    Ok(())
}

/// Reads one leaf `{file_hash}@v{version}` under
/// `file-history/{session_uuid}/`, traversal-safe, delegating to the
/// root-anchored `claude_read::read_confined_file`.
pub fn read_checkpoint(
    root: &str,
    session_uuid: &str,
    file_hash: &str,
    version: u32,
) -> Result<String, String> {
    let bytes = read_checkpoint_bytes(root, session_uuid, file_hash, version)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn read_checkpoint_bytes(
    root: &str,
    session_uuid: &str,
    file_hash: &str,
    version: u32,
) -> Result<Vec<u8>, String> {
    validate_ids(session_uuid, file_hash)?;
    claude_read::read_confined_file(
        root,
        &format!("file-history/{session_uuid}"),
        &format!("{file_hash}@v{version}"),
    )
}

/// Copies one checkpoint leaf to `dest` as RAW BYTES — not `read_checkpoint`'s
/// lossy UTF-8 `String` — so a non-UTF-8 checkpoint exports byte-exact. `dest`
/// is a user-chosen path from the native save dialog and is deliberately NOT
/// root-confined; the user authorizes it by picking it.
pub fn export_checkpoint_to(
    root: &str,
    session_uuid: &str,
    file_hash: &str,
    version: u32,
    dest: &Path,
) -> Result<(), String> {
    let bytes = read_checkpoint_bytes(root, session_uuid, file_hash, version)?;
    fs::write(dest, &bytes).map_err(|e| format!("files: write checkpoint export: {e}"))
}

#[cfg(test)]
#[path = "filehistory_reader_tests.rs"]
mod filehistory_reader_tests;
