//! Shared low-level plumbing for the write-safety spine (not a Go file — this
//! backs the per-module `atomicWriteX` helpers Go inlines with `os.WriteFile`).
//!
//! `write_file_mode` mirrors Go `os.WriteFile(path, data, perm)` (perm applies
//! on create, subject to umask); `set_mode` mirrors `os.Chmod` (defeats umask,
//! called only exactly where Go calls Chmod). `lock` is a poison-free mutex
//! acquire so a panicking test never cascades into unrelated write families —
//! Go mutexes don't poison, and none of these writers hold invariants across a
//! panic.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

/// Mirrors `os.WriteFile(path, data, mode)`: create/truncate with `mode`
/// (honored only on creation, subject to umask — same as Go).
pub(crate) fn write_file_mode(path: &Path, data: &[u8], mode: u32) -> io::Result<()> {
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(path)?;
    f.write_all(data)
}

/// Mirrors `os.Chmod(path, mode)` — sets the mode unconditionally, defeating
/// umask. Call ONLY where Go calls Chmod.
pub(crate) fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

/// Poison-free `Mutex<()>` acquire (Go semantics: no poisoning).
pub(crate) fn lock(m: &Mutex<()>) -> MutexGuard<'_, ()> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
