//! Shared confined-read plumbing for read-only `~/.claude` subdir viewers
//! (shell-snapshots, telemetry, file-history). Listing is done in-module via
//! `std::fs::read_dir`, like `skills_inventory.rs` — `files/` stays a leaf
//! module and never reaches into `maintenance/`.

use std::fs::{self, OpenOptions};
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::files::pathutil;

/// One file's metadata for a read-only directory listing. `mtime` is epoch
/// milliseconds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub name: String,
    pub size_bytes: i64,
    pub mtime: i64,
}

/// Lists files directly under `<root>/<subdir>` whose extension equals `ext`.
/// Skips directories, dotfiles, and non-matching entries (e.g. `.DS_Store`).
/// A missing `<root>/<subdir>` directory is tolerant: returns `Ok(vec![])`.
pub fn list_dir_files(root: &str, subdir: &str, ext: &str) -> Result<Vec<FileMeta>, String> {
    let dir = Path::new(root).join(subdir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        if entry.path().extension().and_then(|e| e.to_str()) != Some(ext) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(FileMeta {
            name,
            size_bytes: meta.len() as i64,
            mtime,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Reads one file at `<root>/<subdir>/<name>`, traversal-safe.
/// SECURITY BOUNDARY: the confinement anchor is `fs::canonicalize(root)` — the
/// fixed root, NOT `<root>/<subdir>` — so a symlinked `subdir` component
/// escaping the root is still caught by the containment check.
pub fn read_confined_file(root: &str, subdir: &str, name: &str) -> Result<Vec<u8>, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("files: invalid name".to_string());
    }

    let candidate = Path::new(root).join(subdir).join(name);
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let confined = pathutil::confine(
        &candidate.to_string_lossy(),
        &canonical_root.to_string_lossy(),
    )?;
    fs::read(confined).map_err(|e| e.to_string())
}

/// Reads one confined file without allocating beyond `max_bytes` plus one
/// byte. The leaf is opened with no-follow semantics where the platform
/// supports them so a symlink swap cannot redirect the checkpoint read.
pub fn read_confined_file_bounded(
    root: &str,
    subdir: &str,
    name: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("files: invalid name".to_string());
    }

    let candidate = Path::new(root).join(subdir).join(name);
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let confined = pathutil::confine(
        &candidate.to_string_lossy(),
        &canonical_root.to_string_lossy(),
    )?;
    let mut file = open_read_no_follow(&confined).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("files: checkpoint is not a regular file".to_string());
    }
    let mut bytes = Vec::with_capacity(max_bytes.saturating_add(1));
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > max_bytes {
        return Err("files: checkpoint exceeds the bounded read size".to_string());
    }
    Ok(bytes)
}

fn open_read_no_follow(path: &Path) -> std::io::Result<fs::File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
    }
    #[cfg(not(unix))]
    {
        OpenOptions::new().read(true).open(path)
    }
}

#[cfg(test)]
#[path = "claude_read_tests.rs"]
mod claude_read_tests;
