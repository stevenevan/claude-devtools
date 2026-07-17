//! Ports `internal/files/text_write.go` — the write path for global instruction
//! files (CLAUDE.md, RTK.md, rules/, commands/, tools/) that steer every Claude
//! Code session — a SECURITY-CRITICAL surface. Every path funnels through the
//! same lexical-clean + allowlist + confine-PARENT-to-root pipeline:
//! `pathutil::confine` returns a non-existent candidate UNCHANGED with zero
//! containment check, so guarding the PARENT — never the not-yet-existing leaf —
//! is the only safe way to block a symlinked `rules/` escaping root.
//!
//! `clean` and `atomic_write_file` are reused from `agents_write.rs` (Go shares
//! `filepath.Clean` / `atomicWriteFile` package-wide).

use std::fs;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::files::agents_write::{atomic_write_file, clean};
use crate::files::fsutil;
use crate::files::pathutil::confine;
use crate::tokenizer::count_tokens;

/// Discriminates `INSTRUCTION_ALLOWLIST` entries. A future segment-glob kind
/// (e.g. `projects/*/memory/**`) is deliberately unbuilt — the enum stays
/// extensible, glob matching isn't added until needed. Mirrors `allowKind`.
enum AllowKind {
    ExactFile,
    DirPrefix,
}

struct AllowRule {
    kind: AllowKind,
    path: &'static str,
}

/// The single, data-driven source of truth for which relative paths under the
/// claude root are readable/writable/listable. Read/write/list all consume it
/// through `match_allowlist` so the three surfaces can never drift.
static INSTRUCTION_ALLOWLIST: &[AllowRule] = &[
    AllowRule {
        kind: AllowKind::ExactFile,
        path: "CLAUDE.md",
    },
    AllowRule {
        kind: AllowKind::ExactFile,
        path: "RTK.md",
    },
    AllowRule {
        kind: AllowKind::DirPrefix,
        path: "rules",
    },
    AllowRule {
        kind: AllowKind::DirPrefix,
        path: "commands",
    },
    AllowRule {
        kind: AllowKind::DirPrefix,
        path: "tools",
    },
];

/// The single mutex for the whole instruction-file family — one lock, not a
/// per-path map — since the service layer already serializes. Mirrors
/// `instructionWriteMu`.
static INSTRUCTION_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Reports whether `cleaned` (already `clean`'d, relative) matches an allowlist
/// entry. Directory-prefix matches are segment-bounded — `rules`/`rules/x.md`
/// match, but `rules-evil.md` does NOT. Mirrors `matchAllowlist`.
fn match_allowlist(cleaned: &str) -> bool {
    for rule in INSTRUCTION_ALLOWLIST {
        match rule.kind {
            AllowKind::ExactFile => {
                if cleaned == rule.path {
                    return true;
                }
            }
            AllowKind::DirPrefix => {
                if cleaned == rule.path || cleaned.starts_with(&format!("{}/", rule.path)) {
                    return true;
                }
            }
        }
    }
    false
}

/// Lexically rejects any `rel_path` not already in canonical, relative,
/// non-parent-escaping form, THEN checks the allowlist — both gates before any
/// filesystem call. Mirrors `validateRelPath`; error sentinels byte-identical.
fn validate_rel_path(rel_path: &str) -> Result<String, String> {
    let cleaned = clean(rel_path);
    if cleaned != rel_path
        || Path::new(&cleaned).is_absolute()
        || cleaned == ".."
        || cleaned.starts_with("../")
    {
        return Err(format!("files: invalid instruction file path {rel_path:?}"));
    }
    if !match_allowlist(&cleaned) {
        return Err(format!(
            "files: {rel_path:?} is not in the instruction-file allowlist"
        ));
    }
    Ok(cleaned)
}

/// Validates `rel_path` (lexical + allowlist) and resolves it to an absolute path
/// confined within `root`: canonicalize root, create the leaf's parent if
/// missing, then canonicalize + confine the PARENT (never the leaf). Mirrors
/// `ResolveInstructionPath`.
pub fn resolve_instruction_path(root: &str, rel_path: &str) -> Result<String, String> {
    let cleaned = validate_rel_path(rel_path)?;

    let canon_root =
        fs::canonicalize(root).map_err(|e| format!("files: instruction root {root:?}: {e}"))?;

    let abs = canon_root.join(&cleaned);
    let parent = abs.parent().unwrap_or(canon_root.as_path());
    fs::create_dir_all(parent).map_err(|e| format!("files: create instruction directory: {e}"))?;

    let parent_canon =
        fs::canonicalize(parent).map_err(|e| format!("files: instruction parent directory: {e}"))?;
    confine(
        &parent_canon.to_string_lossy(),
        &canon_root.to_string_lossy(),
    )?;

    let base = Path::new(&cleaned).file_name().unwrap_or_default();
    Ok(parent_canon.join(base).to_string_lossy().into_owned())
}

/// The atomic read-transform-write primitive every instruction-file mutator
/// routes through: lock, resolve+confine, read the CURRENT bytes fresh (closes
/// the TOCTOU window), run `transform`, reject non-UTF-8 output, back up the
/// previous content to `rel_path.bak` (only if it existed), write the new
/// content — both `.bak` and final via temp+rename. Mirrors `MutateTextFile`.
pub fn mutate_text_file<F>(root: &str, rel_path: &str, transform: F) -> Result<(), String>
where
    F: FnOnce(&[u8]) -> Result<Vec<u8>, String>,
{
    let _guard = fsutil::lock(&INSTRUCTION_WRITE_MU);

    let dest = resolve_instruction_path(root, rel_path)?;

    let (current, had_current): (Vec<u8>, bool) = match fs::read(&dest) {
        Ok(bytes) => (bytes, true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Vec::new(), false),
        Err(e) => return Err(format!("files: read {rel_path:?}: {e}")),
    };

    let next = transform(&current)?;
    if std::str::from_utf8(&next).is_err() {
        return Err(format!(
            "files: refusing to write non-UTF-8 content to {rel_path:?}"
        ));
    }

    if had_current {
        atomic_write_file(&format!("{dest}.bak"), &current)
            .map_err(|e| format!("files: write backup for {rel_path:?}: {e}"))?;
    }
    atomic_write_file(&dest, &next).map_err(|e| format!("files: write {rel_path:?}: {e}"))?;
    Ok(())
}

/// Blindly replaces `rel_path`'s whole content — the normal editor-save path —
/// through `mutate_text_file`. No format transformation: content is written
/// byte-for-byte. Mirrors `WriteTextFile`.
pub fn write_text_file(root: &str, rel_path: &str, content: &[u8]) -> Result<(), String> {
    mutate_text_file(root, rel_path, |_current| {
        if std::str::from_utf8(content).is_err() {
            return Err(format!(
                "files: refusing to write non-UTF-8 content to {rel_path:?}"
            ));
        }
        Ok(content.to_vec())
    })
}

/// Returns `rel_path`'s raw bytes, applying the same lexical + allowlist +
/// confine-parent safety as `mutate_text_file`. Non-UTF-8 content is rejected.
/// Mirrors `ReadTextFile`.
pub fn read_text_file(root: &str, rel_path: &str) -> Result<Vec<u8>, String> {
    let dest = resolve_instruction_path(root, rel_path)?;
    let data = fs::read(&dest).map_err(|e| format!("files: read {rel_path:?}: {e}"))?;
    if std::str::from_utf8(&data).is_err() {
        return Err(format!("files: {rel_path:?} is not valid UTF-8"));
    }
    Ok(data)
}

/// One entry in `list_instruction_files`' result: an allowlisted file's size and
/// approximate context-window cost. Mirrors `InstructionFile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionFile {
    pub rel_path: String,
    pub bytes: usize,
    pub approx_tokens: usize,
}

/// Walks every `INSTRUCTION_ALLOWLIST` entry under `root` and reports each
/// matched file's size + token cost (via `tokenizer::count_tokens`, not a
/// bytes/4 estimate). Read-only: a missing root or individual dir yields no
/// entries for it, not an error. Mirrors `ListInstructionFiles`.
pub fn list_instruction_files(root: &str) -> Result<Vec<InstructionFile>, String> {
    let canon_root =
        fs::canonicalize(root).map_err(|e| format!("files: instruction root {root:?}: {e}"))?;

    let mut out: Vec<InstructionFile> = Vec::new();
    for rule in INSTRUCTION_ALLOWLIST {
        match rule.kind {
            AllowKind::ExactFile => {
                if let Some(entry) = stat_instruction_file(&canon_root, rule.path) {
                    out.push(entry);
                }
            }
            AllowKind::DirPrefix => match walk_instruction_dir(&canon_root, rule.path) {
                Ok(entries) => out.extend(entries),
                Err(_) => continue,
            },
        }
    }

    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(out)
}

/// Mirrors `statInstructionFile`.
fn stat_instruction_file(canon_root: &Path, rel_path: &str) -> Option<InstructionFile> {
    let content = fs::read(canon_root.join(rel_path)).ok()?;
    Some(InstructionFile {
        rel_path: rel_path.to_string(),
        bytes: content.len(),
        approx_tokens: count_tokens(&String::from_utf8_lossy(&content)),
    })
}

/// Lists every file under `canon_root/dir_rel_path`, skipping subdirectories, the
/// write primitive's own `.bak`/`.tmp` byproducts, and anything
/// `match_allowlist` would reject. Mirrors `walkInstructionDir`.
fn walk_instruction_dir(canon_root: &Path, dir_rel_path: &str) -> Result<Vec<InstructionFile>, String> {
    let dir_abs = canon_root.join(dir_rel_path);
    fs::metadata(&dir_abs).map_err(|e| e.to_string())?;

    let mut out: Vec<InstructionFile> = Vec::new();
    walk_dir_recursive(canon_root, &dir_abs, &mut out)?;
    Ok(out)
}

fn walk_dir_recursive(
    canon_root: &Path,
    dir: &Path,
    out: &mut Vec<InstructionFile>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let path = entry.path();
        if file_type.is_dir() {
            walk_dir_recursive(canon_root, &path, out)?;
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".bak") || name.ends_with(".tmp") {
            continue;
        }
        let rel = match path.strip_prefix(canon_root) {
            Ok(r) => r.to_string_lossy().into_owned(),
            Err(_) => continue,
        };
        if !match_allowlist(&rel) {
            continue;
        }
        let content = match fs::read(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        out.push(InstructionFile {
            rel_path: rel,
            bytes: content.len(),
            approx_tokens: count_tokens(&String::from_utf8_lossy(&content)),
        });
    }
    Ok(())
}

#[cfg(test)]
#[path = "text_write_tests.rs"]
mod text_write_tests;
