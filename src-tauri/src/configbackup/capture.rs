//! Ports `internal/configbackup/capture.go` — copies every allowlisted
//! user-authored file under `root` into `<app_data_dir>/config-backups/<uuid>/`
//! (0o700 dirs, mode-preserving copy), SHA-256s each, and writes manifest.json
//! (0o600). Symlinked skills are recorded as `SkillLink` refs (target string
//! only, NO content — an out-of-root repo is a documented non-goal). Symlinks in
//! walks are never followed; `.bak`/`.tmp` byproducts and dot-dirs are skipped.

use std::fs;
use std::io;
use std::path::Path;

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::store::{mkdir_all_mode, set_mode, write_file_mode, write_manifest};
use super::types::{
    config_backups_dir, match_config_allowlist, now_ms, FileEntry, Manifest, SkillLink,
    HOOKS_DISABLED_SNAPSHOT_NAME,
};

/// Copies every allowlisted user-authored file under `root` into the backup
/// store, SHA-256s each, and writes the manifest. When `include_hooks_disabled`
/// is set (the pre-import auto-snapshot), it ALSO snapshots
/// `<app_data_dir>/hooks-disabled.json`. Mirrors `CaptureConfig`.
pub fn capture_config(
    root: &Path,
    app_data_dir: &Path,
    label: &str,
    include_hooks_disabled: bool,
) -> Result<Manifest, String> {
    let canon_root = fs::canonicalize(root)
        .map_err(|e| format!("configbackup: resolve root {}: {e}", root.display()))?;

    let id = Uuid::new_v4().to_string();
    let backup_dir = config_backups_dir(app_data_dir).join(&id);
    mkdir_all_mode(&backup_dir, 0o700).map_err(|e| format!("configbackup: create backup dir: {e}"))?;

    let (rels, skill_links) = collect_config_files(&canon_root);

    let mut manifest = Manifest {
        id: id.clone(),
        label: label.to_string(),
        created_ms: now_ms(),
        secrets_included: false,
        files: Vec::new(),
        skill_links,
    };
    for rel in &rels {
        let entry = copy_capture_file(&canon_root, &backup_dir, rel)?;
        manifest.files.push(entry);
    }

    if include_hooks_disabled {
        capture_hooks_disabled(app_data_dir, &backup_dir)?;
    }

    write_manifest(&backup_dir, &manifest)?;
    Ok(manifest)
}

/// Enumerates every allowlisted file's root-relative path under `canon_root`
/// plus the symlinked-skill link refs. Mirrors `collectConfigFiles`.
fn collect_config_files(canon_root: &Path) -> (Vec<String>, Vec<SkillLink>) {
    let mut rels: Vec<String> = Vec::new();
    let mut skill_links: Vec<SkillLink> = Vec::new();

    for name in ["settings.json", "CLAUDE.md", "RTK.md"] {
        if is_regular_file(&canon_root.join(name)) {
            rels.push(name.to_string());
        }
    }
    for dir in ["rules", "commands", "tools"] {
        walk_allowlisted_files(canon_root, &canon_root.join(dir), &mut rels);
    }
    list_markdown_files_rel(canon_root, &canon_root.join("agents"), &mut rels);
    collect_memory_files(canon_root, "projects", "memory", &mut rels);
    collect_memory_files(canon_root, "agent-memory", "", &mut rels);
    collect_skill_files(canon_root, &mut rels, &mut skill_links);

    (rels, skill_links)
}

/// Lists *.md under `<parent>/<name>/<sub>` for every child dir of `<parent>`
/// (`sub` "" means directly under `<name>`). Mirrors `collectMemoryFiles`.
fn collect_memory_files(canon_root: &Path, parent: &str, sub: &str, out: &mut Vec<String>) {
    let base = canon_root.join(parent);
    for entry in sorted_dir(&base) {
        let Ok(ft) = entry.file_type() else { continue };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !ft.is_dir() || name.starts_with('.') {
            continue;
        }
        let mut dir = base.join(&*name);
        if !sub.is_empty() {
            dir = dir.join(sub);
        }
        list_markdown_files_rel(canon_root, &dir, out);
    }
}

/// Captures real skill dirs (SKILL.md + references/**) and records symlinked
/// skills as link refs, NEVER following a link. Mirrors `collectSkillFiles`.
fn collect_skill_files(canon_root: &Path, rels: &mut Vec<String>, links: &mut Vec<SkillLink>) {
    let skills_base = canon_root.join("skills");
    for entry in sorted_dir(&skills_base) {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let link_path = skills_base.join(&*name);
        let Ok(lst) = fs::symlink_metadata(&link_path) else {
            continue;
        };
        if lst.file_type().is_symlink() {
            if let Ok(target) = fs::read_link(&link_path) {
                links.push(SkillLink {
                    name: name.into_owned(),
                    target: target.to_string_lossy().into_owned(),
                });
            }
            continue;
        }
        if !lst.is_dir() {
            continue;
        }
        let skill_md = skills_base.join(&*name).join("SKILL.md");
        if is_regular_file(&skill_md) {
            if let Some(rel) = rel_path(canon_root, &skill_md) {
                if match_config_allowlist(&rel) {
                    rels.push(rel);
                }
            }
        }
        walk_allowlisted_files(canon_root, &skills_base.join(&*name).join("references"), rels);
    }
}

/// Recursively lists every regular allowlisted file under `abs_dir` (skipping
/// symlinks and .bak/.tmp byproducts), returning root-relative paths. A missing
/// dir yields nothing. Mirrors `walkAllowlistedFiles`.
fn walk_allowlisted_files(canon_root: &Path, abs_dir: &Path, out: &mut Vec<String>) {
    for entry in sorted_dir(abs_dir) {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue; // never follow
        }
        let path = entry.path();
        if ft.is_dir() {
            walk_allowlisted_files(canon_root, &path, out);
            continue;
        }
        let name = entry.file_name();
        if is_bak_tmp(&name.to_string_lossy()) {
            continue;
        }
        if let Some(rel) = rel_path(canon_root, &path) {
            if match_config_allowlist(&rel) {
                out.push(rel);
            }
        }
    }
}

/// Lists non-symlink *.md files directly in `abs_dir` (non-recursive), returning
/// allowlisted root-relative paths. Mirrors `listMarkdownFilesRel`.
fn list_markdown_files_rel(canon_root: &Path, abs_dir: &Path, out: &mut Vec<String>) {
    for entry in sorted_dir(abs_dir) {
        let Ok(ft) = entry.file_type() else { continue };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if ft.is_dir() || ft.is_symlink() || !name.ends_with(".md") {
            continue;
        }
        if let Some(rel) = rel_path(canon_root, &abs_dir.join(&*name)) {
            if match_config_allowlist(&rel) {
                out.push(rel);
            }
        }
    }
}

/// Copies `canon_root/rel` into `backup_dir/rel` (0o700 parents, mode-preserving)
/// and returns its FileEntry with the SHA-256 of the bytes. Mirrors
/// `copyCaptureFile`.
fn copy_capture_file(canon_root: &Path, backup_dir: &Path, rel: &str) -> Result<FileEntry, String> {
    let src = canon_root.join(rel);
    let info = fs::symlink_metadata(&src).map_err(|e| format!("configbackup: stat {rel:?}: {e}"))?;
    let data = fs::read(&src).map_err(|e| format!("configbackup: read {rel:?}: {e}"))?;

    let dest = backup_dir.join(rel);
    if let Some(parent) = dest.parent() {
        mkdir_all_mode(parent, 0o700).map_err(|e| format!("configbackup: mkdir for {rel:?}: {e}"))?;
    }
    let mode = mode_perm(&info);
    write_file_mode(&dest, &data, mode).map_err(|e| format!("configbackup: write {rel:?}: {e}"))?;
    // WriteFile mode is umask-masked; force-preserve like Go's os.Chmod.
    set_mode(&dest, mode).map_err(|e| format!("configbackup: chmod {rel:?}: {e}"))?;

    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(FileEntry {
        rel_path: rel.to_string(),
        size: data.len() as i64,
        sha256: hex_encode(&hasher.finalize()),
    })
}

/// Snapshots `<app_data_dir>/hooks-disabled.json` into the backup under the
/// reserved name, if it exists. A missing file is a no-op. Mirrors
/// `captureHooksDisabled`.
fn capture_hooks_disabled(app_data_dir: &Path, backup_dir: &Path) -> Result<(), String> {
    let data = match fs::read(app_data_dir.join("hooks-disabled.json")) {
        Ok(d) => d,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("configbackup: read hooks-disabled.json: {e}")),
    };
    write_file_mode(&backup_dir.join(HOOKS_DISABLED_SNAPSHOT_NAME), &data, 0o600)
        .map_err(|e| format!("configbackup: snapshot hooks-disabled.json: {e}"))
}

/// Reports whether `path` is a non-symlink regular file. Mirrors `isRegularFile`.
fn is_regular_file(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(meta) => meta.file_type().is_file(),
        Err(_) => false,
    }
}

/// Reports whether `name` is a write-primitive .bak/.tmp byproduct. Mirrors
/// `isBakTmp`.
fn is_bak_tmp(name: &str) -> bool {
    name.ends_with(".bak") || name.ends_with(".tmp")
}

/// `filepath.Rel(canon_root, path)` for a `path` always contained under
/// `canon_root`, yielding a `/`-separated root-relative string.
fn rel_path(canon_root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(canon_root)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Reads a directory into a filename-sorted vec of entries (mirrors Go's
/// `os.ReadDir` order); a missing/unreadable dir yields an empty vec.
fn sorted_dir(dir: &Path) -> Vec<fs::DirEntry> {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    entries
}

#[cfg(unix)]
fn mode_perm(meta: &fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o777
}

#[cfg(not(unix))]
fn mode_perm(_meta: &fs::Metadata) -> u32 {
    0o644
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
#[path = "capture_tests.rs"]
mod capture_tests;
