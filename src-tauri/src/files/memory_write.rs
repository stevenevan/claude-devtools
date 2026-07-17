//! Ports `internal/files/memory_write.go` — the write path for Claude Code
//! memory dirs. Every mutation goes through `MEMORY_WRITE_MU` (a dedicated lock,
//! never shared), resolves the dir by kind-prefixed ID (`resolve_memory_dir` —
//! deterministic split, no scan), and refuses while `<memDir>/.consolidate-lock`
//! is present: Claude Code's own memory consolidator holds that file while
//! rewriting, and racing it would silently clobber its changes.
//!
//! `apply_memory_index_fix` is byte-exact index surgery — the client's fix is
//! RE-DERIVED server-side from a fresh `memory_integrity` scan and rejected
//! unless an identical finding still holds; only the single proposed line is
//! added/removed, every other byte preserved verbatim. `.bak` + atomic
//! temp+rename throughout.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use crate::files::fsutil;
use crate::files::memory::{
    go_path_clean, memory_integrity, resolve_memory_dir, MemoryIndexFix, MemoryReport,
};

/// The single mutex for the whole memory-file family — one lock, not a per-path
/// map — mirroring the skills writer: read-fresh-under-lock kills the
/// lost-update race.
static MEMORY_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Returned while the consolidator's `.consolidate-lock` is present, so a UI can
/// retry rather than clobber a concurrent consolidation. Byte-identical to the
/// Go sentinel (the frontend matches it literally).
pub const ERR_MEMORY_LOCKED: &str = "memory consolidation in progress; try again";

/// Shared atomic write helper (Go: `hooks_write.go` `atomicWriteFile`), homed
/// here pending the `hooks_write`/`fsutil` port. Writes `path + ".tmp"` then
/// renames, matching Go's byte-for-byte behavior + error naming.
pub(crate) fn atomic_write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut tmp_os = path.as_os_str().to_owned();
    tmp_os.push(".tmp");
    let tmp = PathBuf::from(tmp_os);
    let base = tmp
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    fsutil::write_file_mode(&tmp, data, 0o644).map_err(|e| format!("files: write {base}: {e}"))?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("files: rename {base}: {e}"));
    }
    Ok(())
}

/// Rejects any name that isn't a single ".md" leaf (non-empty, .md-suffixed, no
/// separators, no "..", not absolute, lexically clean) before any fs call.
fn validate_memory_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || !file_name.ends_with(".md")
        || file_name.contains("..")
        || file_name.contains('/')
        || file_name.contains(std::path::MAIN_SEPARATOR)
        || Path::new(file_name).is_absolute()
        || go_path_clean(file_name) != file_name
    {
        return Err(format!("files: invalid memory file name {file_name:?}"));
    }
    Ok(())
}

/// Resolves+confines the memory dir (by ID) and joins a validated .md leaf under
/// it. The dir is already confined and the leaf is a plain filename.
pub fn resolve_memory_file_path(
    root: &str,
    dir_id: &str,
    file_name: &str,
) -> Result<String, String> {
    let (mem_dir, _) = resolve_memory_dir(root, dir_id)?;
    validate_memory_file_name(file_name)?;
    Ok(Path::new(&mem_dir)
        .join(file_name)
        .to_string_lossy()
        .into_owned())
}

/// Reports whether the consolidator's `.consolidate-lock` file exists.
fn memory_lock_present(mem_dir: &str) -> bool {
    fs::metadata(Path::new(mem_dir).join(".consolidate-lock")).is_ok()
}

/// Returns one fact file's content for the editor's load. Rejects non-UTF-8.
pub fn read_memory_file(root: &str, dir_id: &str, file_name: &str) -> Result<String, String> {
    let path = resolve_memory_file_path(root, dir_id, file_name)?;
    let data = fs::read(&path).map_err(|e| format!("files: read memory file {file_name:?}: {e}"))?;
    String::from_utf8(data)
        .map_err(|_| format!("files: memory file {file_name:?} is not valid UTF-8"))
}

/// Replaces a fact file (or MEMORY.md) byte-faithfully — a blind full-file
/// write, never a frontmatter reserialize. Locks, resolves, refuses under the
/// consolidation lock, rejects non-UTF-8, and `.bak`'s current bytes before the
/// atomic temp+rename.
pub fn write_memory_file(
    root: &str,
    dir_id: &str,
    file_name: &str,
    content: &[u8],
) -> Result<(), String> {
    let _guard = fsutil::lock(&MEMORY_WRITE_MU);

    if std::str::from_utf8(content).is_err() {
        return Err(format!(
            "files: memory file {file_name:?} content is not valid UTF-8"
        ));
    }

    let (mem_dir, _) = resolve_memory_dir(root, dir_id)?;
    if memory_lock_present(&mem_dir) {
        return Err(ERR_MEMORY_LOCKED.to_string());
    }
    validate_memory_file_name(file_name)?;
    let dest = Path::new(&mem_dir).join(file_name);

    match fs::read(&dest) {
        Ok(current) => {
            atomic_write_file(&append_suffix(&dest, ".bak"), &current).map_err(|e| {
                format!("files: write backup for memory file {file_name:?}: {e}")
            })?;
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("files: read memory file {file_name:?}: {e}")),
    }

    atomic_write_file(&dest, content)
        .map_err(|e| format!("files: write memory file {file_name:?}: {e}"))?;
    Ok(())
}

/// Applies one byte-exact MEMORY.md index edit. Locks, resolves, refuses under
/// the consolidation lock, then RE-DERIVES the fix from a fresh
/// `memory_integrity` scan: the write proceeds only when a finding with an
/// IDENTICAL Fix (same op+line) still holds. `.bak` + atomic temp+rename.
pub fn apply_memory_index_fix(
    root: &str,
    dir_id: &str,
    fix: &MemoryIndexFix,
) -> Result<(), String> {
    let _guard = fsutil::lock(&MEMORY_WRITE_MU);

    let (mem_dir, _) = resolve_memory_dir(root, dir_id)?;
    if memory_lock_present(&mem_dir) {
        return Err(ERR_MEMORY_LOCKED.to_string());
    }

    let report = memory_integrity(root, dir_id)?;
    if !fix_still_holds(&report, fix) {
        return Err("files: memory index fix is stale (no matching finding)".to_string());
    }

    let index_path = Path::new(&mem_dir).join("MEMORY.md");
    let current = match fs::read(&index_path) {
        Ok(d) => d,
        Err(e) if e.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("files: read memory index: {e}")),
    };
    let current_str = String::from_utf8_lossy(&current).into_owned();

    let next = apply_index_fix(&current_str, fix)?;

    if !current.is_empty() {
        atomic_write_file(&append_suffix(&index_path, ".bak"), &current)
            .map_err(|e| format!("files: write backup for memory index: {e}"))?;
    }
    atomic_write_file(&index_path, next.as_bytes())
        .map_err(|e| format!("files: write memory index: {e}"))?;
    Ok(())
}

/// Appends a suffix to a path's full string (Go: `path + suffix`), not a
/// component/extension replace.
pub(crate) fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os = path.as_os_str().to_owned();
    os.push(suffix);
    PathBuf::from(os)
}

/// Reports whether a fresh report contains a finding whose Fix is byte-identical
/// to the client-supplied fix.
fn fix_still_holds(report: &MemoryReport, fix: &MemoryIndexFix) -> bool {
    report.findings.iter().any(|f| {
        f.fix
            .as_ref()
            .is_some_and(|ff| ff.op == fix.op && ff.line == fix.line)
    })
}

/// Dispatches a validated fix onto the current MEMORY.md content.
fn apply_index_fix(content: &str, fix: &MemoryIndexFix) -> Result<String, String> {
    match fix.op.as_str() {
        "add" => Ok(append_index_line(content, &fix.line)),
        "remove" => remove_index_line(content, &fix.line),
        _ => Err(format!("files: unknown memory index fix op {:?}", fix.op)),
    }
}

/// Appends `line` with exactly one entry line and a single trailing newline,
/// inserting a separating newline only when content doesn't already end in one.
/// All prior bytes are preserved (content is a prefix of the result).
fn append_index_line(content: &str, line: &str) -> String {
    let mut b = String::with_capacity(content.len() + line.len() + 2);
    b.push_str(content);
    if !content.is_empty() && !content.ends_with('\n') {
        b.push('\n');
    }
    b.push_str(line);
    b.push('\n');
    b
}

/// Deletes the FIRST line equal to `target` (plus its single trailing newline,
/// if any), leaving every other byte identical. Errors if no exact match exists.
fn remove_index_line(content: &str, target: &str) -> Result<String, String> {
    let len = content.len();
    let mut idx = 0usize;
    while idx <= len {
        let nl = content[idx..].find('\n');
        let (line_end, next_start) = match nl {
            Some(pos) => (idx + pos, idx + pos + 1),
            None => (len, len),
        };
        if &content[idx..line_end] == target {
            return Ok(format!("{}{}", &content[..idx], &content[next_start..]));
        }
        if nl.is_none() {
            break;
        }
        idx = next_start;
    }
    Err("files: memory index line to remove not found".to_string())
}
