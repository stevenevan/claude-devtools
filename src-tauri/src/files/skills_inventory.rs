//! Ports `internal/files/skills_inventory.go` — the read+write path for global
//! skills under `<root>/skills/`. SECURITY-CRITICAL: that directory holds
//! OUT-OF-ROOT SYMLINKS, and the historic foot-gun is writing or deleting
//! THROUGH such a link into a real repo outside `~/.claude`. The asymmetry is
//! deliberate and load-bearing:
//!   - READ (inventory, description, size) MAY follow the link via canonicalize.
//!   - WRITE refuses a symlinked skill outright (editing through it would write
//!     the outside target).
//!   - DELETE (service layer) trashes the LINK entry via `resolve_skill_link_path`
//!     — whose result is NEVER canonicalized, so a rename moves the link, not the
//!     target it points at.
//!
//! `root` is always the caller's EffectivePath, threaded from the service layer.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::files::fsutil;
use crate::files::memory::{go_ext, go_path_clean, is_dir};
use crate::files::memory_write::{append_suffix, atomic_write_file};
use crate::files::pathutil::{confine, parse_frontmatter};

/// The single mutex for the skill-file write family — one lock, not a per-path
/// map — mirroring the memory writer: read-fresh-under-lock kills the
/// lost-update race.
static SKILLS_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// One row of the skills inventory. `is_symlink` is set from an Lstat of the
/// LINK entry (never followed); the remaining fields describe the RESOLVED
/// directory (reads may follow the link — delete/write must not).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInventoryEntry {
    pub name: String,
    pub description: String,
    pub is_symlink: bool,
    pub resolved_path: String,
    pub symlink_target: String,
    pub bytes: i64,
    pub has_references: bool,
    pub has_skill_md: bool,
}

/// Returns `<root>/skills`. `root` is the caller's EffectivePath.
fn skills_dir(root: &str) -> PathBuf {
    Path::new(root).join("skills")
}

/// Rejects any name that isn't a single, filename-safe segment before any fs
/// call — the exact shape of `validate_memory_segment`.
fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains(std::path::MAIN_SEPARATOR)
        || Path::new(name).is_absolute()
        || go_path_clean(name) != name
    {
        return Err(format!("files: invalid skill name {name:?}"));
    }
    Ok(())
}

/// Enumerates `<root>/skills/`, one entry per usable entry. Dotfiles are
/// skipped. Each entry is Lstat'd to set `is_symlink` WITHOUT following: a
/// symlink is then canonicalize-resolved and skipped unless it resolves to a
/// directory; a non-symlink must itself be a directory. Returns an empty
/// (non-nil) slice when the skills dir is missing.
pub fn skills_inventory(root: &str) -> Result<Vec<SkillInventoryEntry>, String> {
    let dir = skills_dir(root);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    let mut out: Vec<SkillInventoryEntry> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }

        let link_path = dir.join(&name);
        let Ok(lst) = fs::symlink_metadata(&link_path) else {
            continue;
        };
        let is_symlink = lst.file_type().is_symlink();

        let mut target = String::new();
        if is_symlink {
            // read_link reports the raw link text WITHOUT following it; the
            // canonicalize below (read-only) is what resolves the target.
            match fs::read_link(&link_path) {
                Ok(t) => target = t.to_string_lossy().into_owned(),
                Err(_) => continue,
            }
        } else if !lst.is_dir() {
            continue; // a bare file under skills/ is not a manageable skill
        }

        let Ok(resolved) = fs::canonicalize(&link_path) else {
            continue; // dangling symlink — not a usable skill
        };
        match fs::metadata(&resolved) {
            Ok(info) if info.is_dir() => {}
            _ => continue, // a symlink to a file/non-dir is not a skill
        }
        let resolved_str = resolved.to_string_lossy().into_owned();

        let (desc, has_skill_md) = skill_description(&resolved_str);
        let has_references =
            is_dir(&resolved.join("references").to_string_lossy());

        let bytes = skill_dir_bytes(&resolved)
            .map_err(|e| format!("files: measure skill {name:?}: {e}"))?;

        out.push(SkillInventoryEntry {
            name,
            description: desc,
            is_symlink,
            resolved_path: resolved_str,
            symlink_target: target,
            bytes,
            has_references,
            has_skill_md,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Reads SKILL.md under a resolved skill dir, returning its frontmatter
/// description and whether the file exists. A resolved dir without a SKILL.md is
/// a utility dir, not a manageable skill.
fn skill_description(resolved_dir: &str) -> (String, bool) {
    let skill_md = Path::new(resolved_dir).join("SKILL.md");
    if fs::metadata(&skill_md).is_err() {
        return (String::new(), false);
    }
    let Ok(content) = fs::read(&skill_md) else {
        return (String::new(), true);
    };
    let fm = parse_frontmatter(&String::from_utf8_lossy(&content));
    (fm.get("description").cloned().unwrap_or_default(), true)
}

/// Measures the RESOLVED skill dir's byte size via Lstat-only walk: symlink
/// children contribute 0 (never descended), and .bak/.tmp editor byproducts are
/// skipped so an edited skill isn't double-counted.
fn skill_dir_bytes(resolved_dir: &Path) -> Result<i64, String> {
    let mut total: i64 = 0;
    walk_bytes(resolved_dir, &mut total)?;
    Ok(total)
}

fn walk_bytes(dir: &Path, total: &mut i64) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            walk_bytes(&entry.path(), total)?;
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let ext = go_ext(&name);
        if ext == ".bak" || ext == ".tmp" {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        *total += meta.len() as i64;
    }
    Ok(())
}

/// Validates `skill_name` and returns the confined LINK path
/// `<canonSkillsDir>/<skillName>` — NEVER canonicalized, so a caller trashing the
/// result moves the link entry itself, never the outside target it points at. It
/// canonicalizes root and the skills dir and Confine-checks the PARENT (skills
/// dir) within root; a missing skills dir is an error.
pub fn resolve_skill_link_path(root: &str, skill_name: &str) -> Result<String, String> {
    validate_skill_name(skill_name)?;

    let canon_root =
        fs::canonicalize(root).map_err(|e| format!("files: skills root {root:?}: {e}"))?;
    let canon_root_str = canon_root.to_string_lossy().into_owned();

    let parent_canon = fs::canonicalize(skills_dir(&canon_root_str))
        .map_err(|e| format!("files: skills directory: {e}"))?;
    let parent_canon_str = parent_canon.to_string_lossy().into_owned();
    confine(&parent_canon_str, &canon_root_str)?;

    // CRITICAL: joined raw, NEVER canonicalized — the result is the LINK entry.
    Ok(parent_canon.join(skill_name).to_string_lossy().into_owned())
}

/// Validates `skill_name` and returns the confined entry path — the SAME path
/// `resolve_skill_link_path` returns. The two exports differ only in intent:
/// callers Lstat the result to branch a real dir (delete) from a symlink
/// (remove-link).
pub fn resolve_skill_dir_path(root: &str, skill_name: &str) -> Result<String, String> {
    resolve_skill_link_path(root, skill_name)
}

/// Returns a skill's SKILL.md content for display/editing. Unlike
/// `write_skill_doc` it MAY follow a symlink (the read/delete asymmetry): a
/// linked skill's SKILL.md is still shown read-only.
pub fn read_skill_doc(root: &str, skill_name: &str) -> Result<String, String> {
    let entry = resolve_skill_dir_path(root, skill_name)?;
    let resolved =
        fs::canonicalize(&entry).map_err(|e| format!("files: skill {skill_name:?}: {e}"))?;
    let data = fs::read(resolved.join("SKILL.md"))
        .map_err(|e| format!("files: skill {skill_name:?} has no SKILL.md: {e}"))?;
    String::from_utf8(data)
        .map_err(|_| format!("files: skill {skill_name:?} SKILL.md is not valid UTF-8"))
}

/// Replaces `<resolvedDir>/SKILL.md` byte-for-byte for a REAL skill dir only. It
/// locks, resolves the confined entry path, and Lstat's it: a symlink is REFUSED
/// (editing through it would write the outside target); a real dir with no
/// existing SKILL.md is REFUSED (never fabricate one). content must be valid
/// UTF-8. The write is a blind full-file replace, `.bak`-first via atomic
/// temp+rename so nothing is torn or written through a possible symlink.
pub fn write_skill_doc(root: &str, skill_name: &str, content: &[u8]) -> Result<(), String> {
    let _guard = fsutil::lock(&SKILLS_WRITE_MU);

    if std::str::from_utf8(content).is_err() {
        return Err(format!(
            "files: skill {skill_name:?} SKILL.md content is not valid UTF-8"
        ));
    }

    // resolve_skill_link_path and resolve_skill_dir_path return the identical
    // confined entry path, so one resolution suffices — the value is both the
    // link to Lstat for the symlink guard AND the real dir to write into.
    let entry = resolve_skill_dir_path(root, skill_name)?;
    let entry_path = Path::new(&entry);

    let lst = fs::symlink_metadata(entry_path)
        .map_err(|e| format!("files: skill {skill_name:?}: {e}"))?;
    if lst.file_type().is_symlink() {
        return Err(format!(
            "files: refusing to edit symlinked skill {skill_name:?}: editing through a symlink writes the outside target"
        ));
    }
    if !lst.is_dir() {
        return Err(format!("files: skill {skill_name:?} is not a directory"));
    }

    let skill_md = entry_path.join("SKILL.md");
    let current = fs::read(&skill_md)
        .map_err(|e| format!("files: skill {skill_name:?} has no SKILL.md to edit: {e}"))?;

    atomic_write_file(&append_suffix(&skill_md, ".bak"), &current)
        .map_err(|e| format!("files: write backup for skill {skill_name:?}: {e}"))?;
    atomic_write_file(&skill_md, content)
        .map_err(|e| format!("files: write skill {skill_name:?}: {e}"))?;
    Ok(())
}

#[cfg(test)]
#[path = "skills_inventory_tests.rs"]
mod skills_inventory_tests;
