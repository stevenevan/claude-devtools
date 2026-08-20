//! Resolves a `file-history/{uuid}/{hash}@vN` checkpoint leaf back to the real
//! path it was captured from, by reading the owning session's
//! `snapshot.trackedFileBackups` map. Read-only — nothing here writes, but the
//! string it returns pre-aims a save dialog, so every resolved path is
//! validated before it leaves this module.

use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::discovery::path_decoder;
use crate::files::filehistory_reader::validate_ids;
use crate::files::pathutil;
use crate::parsing::session_parser::streaming::MAX_JSONL_LINE_BYTES;

/// Where a checkpoint's bytes originally came from. `backup_time` is the ISO
/// timestamp the session recorded for the most recent matching backup.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointOrigin {
    pub real_path: String,
    pub backup_time: Option<String>,
}

/// Matches on the HASH SEGMENT of `backupFileName`, not the full `{hash}@vN`.
/// `trackedFileBackups` records the *current* backup name per file, so by the
/// time a snapshot line is written a tracked file is usually already at `@v2` —
/// an exact `{hash}@v{version}` match therefore fails for every `@v1` leaf,
/// which is the version a user most wants back. Measured over all 141 local
/// `file-history` dirs (2566 leaves): every one of the 626 exact-match misses
/// was `@v1`, and no hash mapped to more than one distinct real path.
pub fn resolve_checkpoint_origin(
    root: &str,
    session_uuid: &str,
    file_hash: &str,
) -> Result<Option<CheckpointOrigin>, String> {
    validate_ids(session_uuid, file_hash)?;

    let Some(session_file) = locate_session_file(root, session_uuid)? else {
        return Ok(None);
    };
    let Some(trusted_root) = trusted_project_root(&session_file) else {
        return Ok(None);
    };
    scan_session(&session_file, file_hash, &trusted_root)
}

/// Finds `<root>/projects/*/{session_uuid}.jsonl`. Returns `Ok(None)` when the
/// uuid is absent, and also when it matches under MORE than one project dir —
/// picking by unspecified `read_dir` order would silently aim an overwrite at
/// one of two candidates.
fn locate_session_file(root: &str, session_uuid: &str) -> Result<Option<PathBuf>, String> {
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let Ok(entries) = fs::read_dir(Path::new(root).join("projects")) else {
        return Ok(None);
    };

    let leaf = format!("{session_uuid}.jsonl");
    let mut found: Option<PathBuf> = None;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let candidate = entry.path().join(&leaf);
        // `confine` returns a NON-EXISTENT candidate unchanged with `Ok`, so
        // this probe — not the confine call — is what proves the file is
        // there. Confinement only rejects a project dir symlinked out of root.
        if !candidate.is_file() {
            continue;
        }
        let Ok(confined) = pathutil::confine(
            &candidate.to_string_lossy(),
            &canonical_root.to_string_lossy(),
        ) else {
            continue;
        };
        if found.is_some() {
            return Ok(None);
        }
        found = Some(PathBuf::from(confined));
    }
    Ok(found)
}

/// One streaming pass: tracks the session `cwd` seen so far (relative keys
/// resolve against it) and collects every distinct real path whose backup name
/// carries `file_hash`. Tolerant — a malformed or oversized line is skipped,
/// never fatal.
fn scan_session(
    session_file: &Path,
    file_hash: &str,
    trusted_root: &Path,
) -> Result<Option<CheckpointOrigin>, String> {
    let file = File::open(session_file).map_err(|e| e.to_string())?;

    let mut cwd: Option<String> = None;
    let mut paths: BTreeSet<String> = BTreeSet::new();
    let mut backup_time: Option<String> = None;

    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            continue;
        };
        // Same guard as `session_parser::streaming` — a pathological producer
        // must not make us allocate gigabytes of contiguous heap.
        if line.len() > MAX_JSONL_LINE_BYTES {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(dir) = value.get("cwd").and_then(Value::as_str) {
            if !dir.is_empty() {
                cwd = Some(dir.to_string());
            }
        }
        let Some(tracked) = value
            .get("snapshot")
            .and_then(|snapshot| snapshot.get("trackedFileBackups"))
            .and_then(Value::as_object)
        else {
            continue;
        };

        for (key, entry) in tracked {
            // confirm-at-impl: entries are objects today —
            // `{backupFileName, version, backupTime, realParentDir?}` — and
            // `backupFileName` is sometimes null. An older shape is declared as
            // `Record<string, string>` in frontend/src/shared/types/jsonl.ts,
            // so a non-object value is skipped rather than assumed away.
            let Some(entry) = entry.as_object() else {
                continue;
            };
            let Some(backup_name) = entry.get("backupFileName").and_then(Value::as_str) else {
                continue;
            };
            let Some((hash, _)) = backup_name.rsplit_once("@v") else {
                continue;
            };
            if hash != file_hash {
                continue;
            }
            let Some(resolved) = resolve_entry_path(key, entry, cwd.as_deref(), trusted_root)
            else {
                continue;
            };
            backup_time = entry
                .get("backupTime")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(backup_time);
            paths.insert(resolved);
        }
    }

    // Zero matches is a normal state (the UI falls back to Save as…). More than
    // one distinct path for a single hash is ambiguous, and this value pre-aims
    // an overwrite — fail closed rather than guess.
    if paths.len() != 1 {
        return Ok(None);
    }
    let real_path = paths.into_iter().next().expect("exactly one path");
    Ok(Some(CheckpointOrigin {
        real_path,
        backup_time,
    }))
}

/// The three observed key forms, in precedence order: `realParentDir` plus the
/// key's basename; an already-absolute key; a key relative to the session cwd.
fn resolve_entry_path(
    key: &str,
    entry: &Map<String, Value>,
    cwd: Option<&str>,
    trusted_root: &Path,
) -> Option<String> {
    let key_path = Path::new(key);
    let candidate = match entry.get("realParentDir").and_then(Value::as_str) {
        Some(parent) if !parent.is_empty() => Path::new(parent).join(key_path.file_name()?),
        _ if key_path.is_absolute() => key_path.to_path_buf(),
        _ => Path::new(cwd?).join(key_path),
    };
    validate_resolved(candidate, trusted_root)
}

/// The session JSONL is a trust boundary — `validate_ids` covers only the two
/// IPC arguments, not what the file says. A path that is not absolute, walks
/// through `..`, or has no final component never becomes an origin.
fn validate_resolved(path: PathBuf, trusted_root: &Path) -> Option<String> {
    if !path.is_absolute() || !path.starts_with(trusted_root) {
        return None;
    }
    if path.components().any(|part| part == Component::ParentDir) {
        return None;
    }
    path.file_name()?;
    Some(path.to_string_lossy().into_owned())
}

fn trusted_project_root(session_file: &Path) -> Option<PathBuf> {
    let project_id = session_file.parent()?.file_name()?.to_str()?;
    let project_id = path_decoder::extract_base_dir(project_id);
    let decoded = path_decoder::decode_path_smart(project_id, None);
    let path = PathBuf::from(decoded);
    (path.is_absolute()
        && path != Path::new("/")
        && !path
            .components()
            .any(|component| component == Component::ParentDir))
    .then_some(path)
}

#[cfg(test)]
#[path = "checkpoint_origin_tests.rs"]
mod checkpoint_origin_tests;
