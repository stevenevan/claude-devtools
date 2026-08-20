//! Shared Codex inventory filesystem helpers.
//!
//! The helpers in this module are intentionally small. They provide bounded
//! reads, source-relative confinement, deterministic opaque ids, and the
//! read-only symlink exception needed by Codex skills. Instruction and agent
//! writers must use the rejecting `confined_path`; skill discovery may use
//! `resolve_readonly_directory`.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};

use crate::types::codex_inventory::{CodexInventoryScope, CodexRecordKind, CodexSourceIdentity};

pub(crate) const MAX_INVENTORY_ITEMS: usize = 256;
pub(crate) const MAX_DIAGNOSTICS: usize = 64;
pub(crate) const MAX_RESOURCE_NAMES: usize = 128;
pub(crate) const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_DETAIL_BYTES: usize = 256 * 1024;
pub(crate) const DEFAULT_PROJECT_DOC_MAX_BYTES: usize = 32 * 1024;
pub(crate) const MAX_PROJECT_DOC_MAX_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_FALLBACK_FILENAMES: usize = 16;
pub(crate) const MAX_FALLBACK_FILENAME_BYTES: usize = 128;

#[derive(Debug, Clone)]
pub(crate) struct BoundedText {
    pub text: String,
    pub truncated: bool,
    pub bytes_read: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct ReadonlyDirectory {
    pub entry_path: PathBuf,
    pub target_path: PathBuf,
    pub is_symlink: bool,
    pub external_target: bool,
}

/// Validate a path that is intended to remain relative to a trusted root.
pub(crate) fn validate_relative_path(relative: &Path) -> io::Result<()> {
    if relative.is_absolute() {
        return Err(permission_error("absolute paths are not allowed"));
    }
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(permission_error(
                "path traversal and non-normal components are not allowed",
            ));
        }
    }
    Ok(())
}

/// Resolve an existing file or directory without following any symlink in
/// the source-relative path. This is the only resolver writable Codex files
/// should use.
pub(crate) fn confined_path(root: &Path, relative: &Path) -> io::Result<PathBuf> {
    validate_relative_path(relative)?;
    let canonical_root = fs::canonicalize(root)?;
    let candidate = root.join(relative);
    let mut component_path = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            unreachable!("validate_relative_path rejected non-normal component");
        };
        component_path.push(name);
        match fs::symlink_metadata(&component_path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(permission_error("symlink paths are not allowed"));
            }
            Ok(_) => {}
            Err(error) => return Err(error),
        }
    }
    let canonical_candidate = fs::canonicalize(candidate)?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(permission_error("path is outside the Codex source root"));
    }
    Ok(canonical_candidate)
}

pub(crate) fn read_bounded_file(path: &Path, max_bytes: usize) -> io::Result<BoundedText> {
    let (bytes, truncated) = read_bounded_bytes(path, max_bytes)?;
    let text = bounded_utf8(&bytes, max_bytes);
    Ok(BoundedText {
        text,
        truncated,
        bytes_read: bytes.len(),
    })
}

pub(crate) fn read_bounded_bytes(path: &Path, max_bytes: usize) -> io::Result<(Vec<u8>, bool)> {
    let mut file = open_read_no_follow(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "expected a regular file",
        ));
    }
    let mut bytes = Vec::with_capacity(max_bytes.saturating_add(1));
    file.take(max_bytes as u64 + 1).read_to_end(&mut bytes)?;
    let truncated = bytes.len() > max_bytes;
    if truncated {
        bytes.truncate(max_bytes);
    }
    Ok((bytes, truncated))
}

pub(crate) fn read_bounded_relative(
    root: &Path,
    relative: &Path,
    max_bytes: usize,
) -> io::Result<BoundedText> {
    let path = confined_path(root, relative)?;
    read_bounded_file(&path, max_bytes)
}

pub(crate) fn exact_revision(path: &Path) -> io::Result<String> {
    let mut file = open_read_no_follow(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// A cheap metadata-only revision for list responses. Detail and writes must
/// use `exact_revision` so content changes cannot be missed.
pub(crate) fn metadata_revision(path: &Path) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(if metadata.is_dir() {
        &b"dir"[..]
    } else {
        &b"file"[..]
    });
    hasher.update(metadata.len().to_le_bytes());
    if let Ok(modified) = metadata.modified() {
        if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
            hasher.update(duration.as_nanos().to_le_bytes());
        }
    }
    Some(format!("meta-{:x}", hasher.finalize()))
}

pub(crate) fn source_identity(
    scope: &CodexInventoryScope,
    kind: CodexRecordKind,
    relative_path: &str,
) -> CodexSourceIdentity {
    let scope_key = match scope {
        CodexInventoryScope::Global => "global".to_string(),
        CodexInventoryScope::Project { project_id } => format!("project:{project_id}"),
    };
    let kind_key = match kind {
        CodexRecordKind::Instruction => "instruction",
        CodexRecordKind::Agent => "agent",
        CodexRecordKind::Skill => "skill",
    };
    let mut hasher = Sha256::new();
    hasher.update(b"codex-inventory-v1\0");
    hasher.update(scope_key.as_bytes());
    hasher.update(b"\0");
    hasher.update(kind_key.as_bytes());
    hasher.update(b"\0");
    hasher.update(relative_path.as_bytes());
    let id = format!("cdx-{:x}", hasher.finalize());
    CodexSourceIdentity {
        id,
        scope: scope.clone(),
        relative_path: relative_path.to_string(),
        label: source_label(scope, relative_path),
    }
}

pub(crate) fn source_label(scope: &CodexInventoryScope, relative_path: &str) -> String {
    match scope {
        CodexInventoryScope::Global => format!("Codex global · {relative_path}"),
        CodexInventoryScope::Project { .. } => format!("Project · {relative_path}"),
    }
}

/// Resolve one skill entry for read-only inspection. Unlike instruction and
/// agent paths, a skill directory may be a symlink because Codex documents
/// support for linked skill folders. The target is required to be a directory;
/// canonicalization rejects cyclic links before any child scan.
pub(crate) fn resolve_readonly_directory(
    root: &Path,
    relative: &Path,
) -> io::Result<ReadonlyDirectory> {
    validate_relative_path(relative)?;
    let canonical_root = fs::canonicalize(root)?;
    let entry_path = root.join(relative);
    let metadata = fs::symlink_metadata(&entry_path)?;
    let is_symlink = metadata.file_type().is_symlink();
    let target_path = fs::canonicalize(&entry_path)?;
    let target_metadata = fs::metadata(&target_path)?;
    if !target_metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "skill entry is not a directory",
        ));
    }
    Ok(ReadonlyDirectory {
        entry_path,
        target_path: target_path.clone(),
        is_symlink,
        external_target: !target_path.starts_with(canonical_root),
    })
}

pub(crate) fn list_directory_names(
    root: &Path,
    max_entries: usize,
) -> io::Result<(Vec<String>, usize)> {
    let mut names = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if names.len() < max_entries {
            names.push(name);
        }
    }
    names.sort();
    let total = fs::read_dir(root)?.count();
    Ok((names, total.saturating_sub(max_entries)))
}

fn bounded_utf8(bytes: &[u8], max_bytes: usize) -> String {
    let valid_len = std::str::from_utf8(bytes)
        .map(|_| bytes.len())
        .unwrap_or_else(|error| error.valid_up_to());
    let mut text = String::from_utf8_lossy(&bytes[..valid_len]).into_owned();
    while text.as_bytes().len() > max_bytes {
        text.pop();
    }
    text
}

fn open_read_no_follow(path: &Path) -> io::Result<File> {
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
        let _ = path;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Codex inventory reads require a no-follow file-open primitive",
        ))
    }
}

fn permission_error(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}

#[cfg(test)]
#[path = "codex_inventory_tests.rs"]
mod tests;
