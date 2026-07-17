//! Ports `internal/maintenance/trash.go` — the safe-delete/trash engine, the ONE
//! destructive primitive every later cleanup feature routes through. Each guard
//! below is reproduced VERBATIM (invariant #3): a confinement or symlink-safety
//! bug here is a data-loss bug in every consumer. Confinement reuses
//! `crate::files::pathutil::confine`; the trash-specific lexical helpers
//! (`confine_parent_to_root`, `confine_restore_dest`, `confine_restore_source`)
//! reproduce the Go `..`-reject + nearest-existing-ancestor logic exactly.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::files::fsutil::{set_mode, write_file_mode};
use crate::files::json_util::to_go_json_pretty;
use crate::files::memory::go_path_clean as go_clean;
use crate::files::pathutil::{confine, ERR_ESCAPES_ROOT};

/// EXDEV ("cross-device link") is 18 on both Linux and macOS. `moveItem` falls
/// back to copy-verify-delete only on this errno (#4/H2).
const EXDEV: i32 = 18;

/// One moved entry inside a `TrashReceipt`'s manifest. serde camelCase mirrors
/// Go's json tags.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedItem {
    pub orig_path: String,
    pub rel_store: String,
    pub bytes: i64,
}

/// The record of one `trash_items` batch, persisted as manifest.json inside its
/// own receipt directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashReceipt {
    pub id: String,
    pub trashed_at: DateTime<Utc>,
    pub items: Vec<TrashedItem>,
}

/// A confinement-checked input path shared by trash + plain-delete. A fix here
/// protects both consumers.
pub(crate) struct ValidatedLeaf {
    pub orig_path: String,
    pub is_symlink: bool,
}

/// The validated, pre-move description of one input path.
struct TrashItemPlan {
    orig_path: String,
    rel_store: String,
}

// ─── TrashItems ──────────────────────────────────────────────────────────────

/// Moves paths into `<app_data_dir>/trash/<receipt_id>/`, validating every path
/// against roots BEFORE moving any of them (invariant #1). roots and
/// app_data_dir are canonicalized once per call (#0) since `~/.claude` or `$HOME`
/// may itself be a symlink.
pub fn trash_items(
    roots: &[String],
    app_data_dir: &str,
    paths: &[String],
) -> Result<TrashReceipt, String> {
    if paths.is_empty() {
        return Err("maintenance: no paths given".to_string());
    }

    let canon_roots = canonicalize_roots(roots)?;
    let canon_app_data = resolve_app_data_dir(app_data_dir, true)?;
    let plans = plan_trash_items(&canon_roots, &canon_app_data, paths)?;

    let receipt_id = uuid::Uuid::new_v4().to_string();
    let r_dir = go_join(&[&canon_app_data, "trash", &receipt_id]);
    // M2: receipt root is 0700 — it holds copies of conversation/config files.
    mkdir_all_mode(&r_dir, 0o700)?;

    let mut receipt = TrashReceipt {
        id: receipt_id,
        trashed_at: Utc::now(),
        items: Vec::new(),
    };

    for p in &plans {
        let dest_path = go_join(&[&r_dir, &p.rel_store]);
        mkdir_all_mode(&go_dir(&dest_path), 0o700)?;

        // L3: re-Lstat immediately before the move to narrow the parent-swap
        // TOCTOU window between planning and the actual rename.
        if let Err(e) = fs::symlink_metadata(&p.orig_path) {
            return Err(format!(
                "maintenance: {:?} vanished before move: {e}",
                p.orig_path
            ));
        }

        let size = path_bytes(&p.orig_path)
            .map_err(|e| format!("maintenance: measure {:?}: {e}", p.orig_path))?;

        move_item(&p.orig_path, &dest_path)
            .map_err(|e| format!("maintenance: move {:?}: {e}", p.orig_path))?;

        // MUST-2: append after this item physically moves, not once at batch
        // end — a crash mid-batch must never leave a moved file with no
        // manifest entry.
        receipt.items.push(TrashedItem {
            orig_path: p.orig_path.clone(),
            rel_store: p.rel_store.clone(),
            bytes: size,
        });
        write_manifest(&r_dir, &receipt)
            .map_err(|e| format!("maintenance: write manifest: {e}"))?;
    }

    Ok(receipt)
}

/// The security-critical path validation every destructive consumer needs BEFORE
/// mutating anything: absolute check, symlink-safe parent resolution (#2 — never
/// confine the leaf, only its parent), Lstat, the root/appdata/trash self-nuke
/// refusal (M1), and input dedupe. It does NOT touch the filesystem's contents.
pub(crate) fn validate_leaves(
    canon_roots: &[String],
    canon_app_data: &str,
    paths: &[String],
) -> Result<Vec<ValidatedLeaf>, String> {
    let trash_dir = go_join(&[canon_app_data, "trash"]);
    let mut seen: HashSet<String> = HashSet::with_capacity(paths.len());
    let mut out = Vec::with_capacity(paths.len());

    for raw in paths {
        let cleaned = go_clean(raw);
        if !is_abs(&cleaned) {
            return Err(format!("maintenance: path {:?} must be absolute", raw));
        }

        // #2 SEC-symlink: never confine the leaf itself (it would resolve
        // through a symlink to its target). Confine only the parent, then Lstat
        // the leaf — consumers act on the link entry, never its target.
        let parent_canon = confine_parent_to_root(&go_dir(&cleaned), canon_roots)
            .map_err(|e| format!("maintenance: {:?}: {e}", raw))?;

        let base = go_base(&cleaned);
        let leaf_path = go_join(&[&parent_canon, &base]);

        let lst = fs::symlink_metadata(&leaf_path)
            .map_err(|e| format!("maintenance: {:?}: {e}", raw))?;

        // M1: refuse root / appdata / trash-tree self-nuke.
        if leaf_path == canon_app_data || is_same_or_within(&leaf_path, &trash_dir) {
            return Err(format!(
                "maintenance: {:?}: refusing to touch the app-data/trash tree",
                raw
            ));
        }
        for r in canon_roots {
            if &leaf_path == r {
                return Err(format!(
                    "maintenance: {:?}: refusing to touch a claude-root directory",
                    raw
                ));
            }
        }

        if seen.contains(&leaf_path) {
            continue; // dedupe inputs identical after canonicalization
        }
        seen.insert(leaf_path.clone());

        out.push(ValidatedLeaf {
            orig_path: leaf_path,
            is_symlink: lst.file_type().is_symlink(),
        });
    }
    Ok(out)
}

/// Validates every input (validate_leaves) then adds the receipt-store layout
/// (rel_store) and the no-nest rule (MUST-2).
fn plan_trash_items(
    canon_roots: &[String],
    canon_app_data: &str,
    paths: &[String],
) -> Result<Vec<TrashItemPlan>, String> {
    let leaves = validate_leaves(canon_roots, canon_app_data, paths)?;

    let mut plans = Vec::with_capacity(leaves.len());
    for leaf in &leaves {
        let (root_index, rel_to_root) = relative_to_one_of(&leaf.orig_path, canon_roots)
            .map_err(|e| format!("maintenance: {:?}: {e}", leaf.orig_path))?;
        plans.push(TrashItemPlan {
            orig_path: leaf.orig_path.clone(),
            // MUST-3: root discriminator prefix — same-basename items from
            // different roots must never collide under one receipt.
            rel_store: go_join(&[&root_index.to_string(), &rel_to_root]),
        });
    }

    reject_nested_inputs(&plans)?;
    Ok(plans)
}

/// Resolves parent (which must exist) and confirms it falls within one of
/// canon_roots, reusing `confine` per-root.
fn confine_parent_to_root(parent: &str, canon_roots: &[String]) -> Result<String, String> {
    let canon = fs::canonicalize(parent)
        .map_err(|e| format!("parent {:?} does not resolve: {e}", parent))?;
    let canon_str = canon.to_string_lossy().into_owned();
    for root in canon_roots {
        if confine(&canon_str, root).is_ok() {
            return Ok(canon_str);
        }
    }
    Err(ERR_ESCAPES_ROOT.to_string())
}

/// Returns the index of the first canon_roots entry that contains path, plus
/// path's slash-relative position under it.
fn relative_to_one_of(path: &str, canon_roots: &[String]) -> Result<(usize, String), String> {
    for (i, root) in canon_roots.iter().enumerate() {
        let Ok(rel) = go_rel(root, path) else {
            continue;
        };
        if rel == ".." || rel.starts_with("../") {
            continue;
        }
        return Ok((i, rel));
    }
    Err(ERR_ESCAPES_ROOT.to_string())
}

/// Refuses a batch where one input is an ancestor directory of another (MUST-2's
/// no-nest rule).
fn reject_nested_inputs(plans: &[TrashItemPlan]) -> Result<(), String> {
    for (i, a) in plans.iter().enumerate() {
        for (j, b) in plans.iter().enumerate() {
            if i == j {
                continue;
            }
            if is_strictly_within(&b.orig_path, &a.orig_path) {
                return Err(format!(
                    "maintenance: input paths must not nest ({:?} contains {:?})",
                    a.orig_path, b.orig_path
                ));
            }
        }
    }
    Ok(())
}

fn is_strictly_within(path: &str, dir: &str) -> bool {
    if path == dir {
        return false;
    }
    let Ok(rel) = go_rel(dir, path) else {
        return false;
    };
    rel != ".." && !rel.starts_with("../")
}

fn is_same_or_within(path: &str, dir: &str) -> bool {
    path == dir || is_strictly_within(path, dir)
}

// ─── ListTrash ───────────────────────────────────────────────────────────────

/// Reads every receipt's manifest.json under `<app_data_dir>/trash`, newest
/// first. A missing app-data dir simply means nothing has ever been trashed;
/// a corrupt/missing manifest is skipped, not fatal.
pub fn list_trash(app_data_dir: &str) -> Result<Vec<TrashReceipt>, String> {
    match fs::metadata(app_data_dir) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        _ => {}
    }
    let canon_app_data = resolve_app_data_dir(app_data_dir, false)?;

    let trash_dir = go_join(&[&canon_app_data, "trash"]);
    let entries = match fs::read_dir(&trash_dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("maintenance: read trash dir: {e}")),
    };

    let mut receipts = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("maintenance: read trash dir: {e}"))?;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        // No/corrupt manifest (e.g. crash before first item wrote it) — skip.
        if let Ok(receipt) = read_manifest(&entry.path().to_string_lossy()) {
            receipts.push(receipt);
        }
    }
    receipts.sort_by(|a, b| b.trashed_at.cmp(&a.trashed_at));
    Ok(receipts)
}

// ─── RestoreTrash ────────────────────────────────────────────────────────────

/// Moves every item in receipt_id back to its orig_path.
///
/// `confine` cannot protect the destination side (invariant #3/C1): it returns a
/// non-existent candidate UNCHANGED with zero containment check, and the restore
/// destination normally does not exist. Manifests are attacker-influenceable, so
/// orig_path gets a lexical confine plus a nearest-existing-ancestor confine
/// (confine_restore_dest). rel_store is validated lexically then confined within
/// the receipt dir, where it actually exists (confine_restore_source).
pub fn restore_trash(roots: &[String], app_data_dir: &str, receipt_id: &str) -> Result<(), String> {
    if !crate::discovery::path_decoder::is_valid_session_id(receipt_id) {
        return Err("maintenance: invalid receipt id".to_string());
    }

    let canon_roots = canonicalize_roots(roots)?;
    let canon_app_data = resolve_app_data_dir(app_data_dir, false)?;

    let r_dir = go_join(&[&canon_app_data, "trash", receipt_id]);
    let receipt =
        read_manifest(&r_dir).map_err(|e| format!("maintenance: receipt {:?}: {e}", receipt_id))?;

    // Validate every item BEFORE moving any of them (invariant #1).
    let mut steps: Vec<(String, String)> = Vec::with_capacity(receipt.items.len());
    for item in &receipt.items {
        let src = confine_restore_source(&item.rel_store, &r_dir)
            .map_err(|e| format!("maintenance: item {:?}: {e}", item.orig_path))?;
        let dest = confine_restore_dest(&item.orig_path, &canon_roots)
            .map_err(|e| format!("maintenance: item {:?}: {e}", item.orig_path))?;
        // L1: Lstat (not Stat) so a dangling symlink still counts as a conflict.
        if fs::symlink_metadata(&dest).is_ok() {
            return Err(format!(
                "maintenance: restore conflict: {:?} already exists",
                dest
            ));
        }
        steps.push((src, dest));
    }

    for (src, dest) in &steps {
        // M2/CONSIDER-D: create the missing tail at 0700, only below an
        // already-confined ancestor (confine_restore_dest verified this above).
        mkdir_all_mode(&go_dir(dest), 0o700)
            .map_err(|e| format!("maintenance: create restore parent for {:?}: {e}", dest))?;
        move_item(src, dest).map_err(|e| format!("maintenance: restore {:?}: {e}", dest))?;
    }

    // Every item moved out — drop the now-empty receipt dir so ListTrash doesn't
    // keep reporting a receipt whose contents are gone.
    remove_all(&r_dir)
}

/// Validates rel_store lexically (reject absolute, reject any ".." segment) and
/// then confines the resolved candidate within receipt_dir, where it actually
/// exists (C2).
fn confine_restore_source(rel_store: &str, receipt_dir: &str) -> Result<String, String> {
    let cleaned = go_clean(rel_store);
    if is_abs(&cleaned) {
        return Err(ERR_ESCAPES_ROOT.to_string());
    }
    for seg in cleaned.split('/') {
        if seg == ".." {
            return Err(ERR_ESCAPES_ROOT.to_string());
        }
    }

    let candidate = go_join(&[receipt_dir, &cleaned]);
    confine(&candidate, receipt_dir)?;
    Ok(candidate)
}

/// Validates orig_path without ever stat-ing the full candidate (C1): Clean +
/// IsAbs + Rel-against-root lexical check, then confine only the nearest EXISTING
/// ancestor — a swapped symlinked ancestor must not redirect the eventual write.
fn confine_restore_dest(orig_path: &str, canon_roots: &[String]) -> Result<String, String> {
    let cleaned = go_clean(orig_path);
    if !is_abs(&cleaned) {
        return Err(format!(
            "maintenance: manifest origPath {:?} must be absolute",
            orig_path
        ));
    }

    let mut root_index: Option<usize> = None;
    for (i, root) in canon_roots.iter().enumerate() {
        match go_rel(root, &cleaned) {
            Ok(rel) if rel != "." && rel != ".." && !rel.starts_with("../") => {
                root_index = Some(i);
                break;
            }
            _ => continue,
        }
    }
    let Some(root_index) = root_index else {
        return Err(ERR_ESCAPES_ROOT.to_string());
    };

    // The missing tail doesn't exist yet (created below via mkdir 0700), so
    // there's nothing to resolve there; only an already-existing ancestor could
    // be a symlink redirecting the write.
    let mut ancestor = go_dir(&cleaned);
    loop {
        if fs::symlink_metadata(&ancestor).is_ok() {
            break;
        }
        let parent = go_dir(&ancestor);
        if parent == ancestor {
            return Err(format!("maintenance: no existing ancestor for {:?}", orig_path));
        }
        ancestor = parent;
    }
    confine(&ancestor, &canon_roots[root_index])?;

    Ok(cleaned)
}

// ─── EmptyTrash ──────────────────────────────────────────────────────────────

/// Permanently deletes the given receipts. Every id is validated before any
/// deletion (MUST-1: fail-closed, abort the whole batch on any invalid id).
pub fn empty_trash(app_data_dir: &str, receipt_ids: &[String]) -> Result<(), String> {
    for id in receipt_ids {
        if !crate::discovery::path_decoder::is_valid_session_id(id) {
            return Err(format!("maintenance: invalid receipt id {:?}", id));
        }
    }

    let canon_app_data = resolve_app_data_dir(app_data_dir, false)?;
    let trash_dir = go_join(&[&canon_app_data, "trash"]);

    for id in receipt_ids {
        remove_all(&go_join(&[&trash_dir, id]))
            .map_err(|e| format!("maintenance: empty receipt {:?}: {e}", id))?;
    }
    Ok(())
}

// ─── shared helpers ──────────────────────────────────────────────────────────

/// Canonicalize every root once (#0/H1) — Confine's Rel math is only correct
/// against an already-resolved root, and `~/.claude` or `$HOME` may itself be a
/// symlink. Fail-closed if a root won't resolve.
pub(crate) fn canonicalize_roots(roots: &[String]) -> Result<Vec<String>, String> {
    let mut canon = Vec::with_capacity(roots.len());
    for r in roots {
        let c = fs::canonicalize(r)
            .map_err(|e| format!("maintenance: root {:?} does not resolve: {e}", r))?;
        canon.push(c.to_string_lossy().into_owned());
    }
    Ok(canon)
}

/// Optionally create app_data_dir (general-purpose — it also holds
/// config/snapshots/cache) then canonicalize it.
pub(crate) fn resolve_app_data_dir(app_data_dir: &str, create: bool) -> Result<String, String> {
    if create {
        fs::create_dir_all(app_data_dir)
            .map_err(|e| format!("maintenance: create app-data dir: {e}"))?;
    }
    let canon = fs::canonicalize(app_data_dir)
        .map_err(|e| format!("maintenance: app-data dir {:?} does not resolve: {e}", app_data_dir))?;
    Ok(canon.to_string_lossy().into_owned())
}

fn read_manifest(receipt_dir: &str) -> Result<TrashReceipt, String> {
    let data = fs::read(go_join(&[receipt_dir, "manifest.json"]))
        .map_err(|e| format!("read manifest: {e}"))?;
    serde_json::from_slice(&data).map_err(|e| format!("parse manifest: {e}"))
}

/// Overwrites manifest.json atomically (temp file + rename), mode 0600 (M2)
/// since it lists conversation/project paths. `to_go_json_pretty` matches Go's
/// `json.MarshalIndent` byte-for-byte (2-space indent + `<>&` HTML escaping), so
/// a path containing those chars round-trips identically.
fn write_manifest(receipt_dir: &str, receipt: &TrashReceipt) -> Result<(), String> {
    let data = to_go_json_pretty(receipt).map_err(|e| format!("marshal manifest: {e}"))?;
    let manifest_file = go_join(&[receipt_dir, "manifest.json"]);
    let tmp = format!("{manifest_file}.tmp");
    write_file_mode(Path::new(&tmp), &data, 0o600).map_err(|e| format!("write manifest.tmp: {e}"))?;
    set_mode(Path::new(&tmp), 0o600).map_err(|e| format!("chmod manifest.tmp: {e}"))?;
    if let Err(e) = fs::rename(&tmp, &manifest_file) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("rename manifest.tmp: {e}"));
    }
    Ok(())
}

/// Renames src to dst, falling back to copy-verify-then-delete on EXDEV
/// (#4/H2). On copy failure the partial copy is removed and src is left intact.
fn move_item(src: &str, dst: &str) -> Result<(), String> {
    match fs::rename(src, dst) {
        Ok(()) => return Ok(()),
        Err(e) if e.raw_os_error() == Some(EXDEV) => {} // cross-device: fall through
        Err(e) => return Err(e.to_string()),
    }

    if let Err(e) = copy_recursive(src, dst) {
        let _ = remove_all(dst);
        return Err(e);
    }
    if fs::symlink_metadata(dst).is_err() {
        let _ = remove_all(dst);
        return Err("copy verification failed".to_string());
    }
    remove_all(src)
}

/// Lstats every entry and recreates symlinks with `symlink` — never copies
/// through them — and preserves each entry's mode (a 0600 session JSONL must not
/// become 0644).
fn copy_recursive(src: &str, dst: &str) -> Result<(), String> {
    let info = fs::symlink_metadata(src).map_err(|e| e.to_string())?;
    let ft = info.file_type();

    if ft.is_symlink() {
        let target = fs::read_link(src).map_err(|e| e.to_string())?;
        return std::os::unix::fs::symlink(&target, dst).map_err(|e| e.to_string());
    }

    if ft.is_dir() {
        let perm = info.permissions().mode() & 0o777;
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            copy_recursive(&go_join(&[src, &name]), &go_join(&[dst, &name]))?;
        }
        return set_mode(Path::new(dst), perm).map_err(|e| e.to_string());
    }

    copy_file(src, dst, info.permissions().mode() & 0o777)
}

fn copy_file(src: &str, dst: &str, mode: u32) -> Result<(), String> {
    let mut input = fs::File::open(src).map_err(|e| e.to_string())?;
    let mut output = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(mode)
        .open(dst)
        .map_err(|e| e.to_string())?;
    io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
    drop(output);
    // OpenOptions' mode is subject to umask; force-preserve exactly.
    set_mode(Path::new(dst), mode).map_err(|e| e.to_string())
}

/// Removes a file, symlink, or directory subtree; nil if it doesn't exist —
/// mirrors Go's `os.RemoveAll`.
fn remove_all(path: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(md) if md.is_dir() => fs::remove_dir_all(path).map_err(|e| e.to_string()),
        Ok(_) => fs::remove_file(path).map_err(|e| e.to_string()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Measures a fresh byte count for path (file or directory subtree) via
/// Lstat/walk only, never following symlinks — a symlink itself contributes 0
/// bytes.
fn path_bytes(path: &str) -> Result<i64, String> {
    let info = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    let ft = info.file_type();
    if ft.is_symlink() {
        return Ok(0);
    }
    if !ft.is_dir() {
        return Ok(info.len() as i64);
    }
    let mut total: i64 = 0;
    walk_sum(path, &mut total)?;
    Ok(total)
}

fn walk_sum(dir: &str, total: &mut i64) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let md = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        let ft = md.file_type();
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            walk_sum(&entry.path().to_string_lossy(), total)?;
            continue;
        }
        *total += md.len() as i64;
    }
    Ok(())
}

fn mkdir_all_mode(path: &str, mode: u32) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("maintenance: mkdir {:?}: {e}", path))?;
    set_mode(Path::new(path), mode).map_err(|e| format!("maintenance: chmod {:?}: {e}", path))
}

// ─── lexical path helpers (Go `filepath` semantics, unix) ────────────────────

fn is_abs(path: &str) -> bool {
    path.starts_with('/')
}

/// Go `filepath.Join`: join non-empty elements with `/`, then Clean.
fn go_join(parts: &[&str]) -> String {
    let non_empty: Vec<&str> = parts.iter().copied().filter(|p| !p.is_empty()).collect();
    if non_empty.is_empty() {
        return String::new();
    }
    go_clean(&non_empty.join("/"))
}

/// Go `filepath.Dir`: all but the last element, Cleaned. Dir of a bare name is
/// ".", Dir of "/" is "/".
fn go_dir(path: &str) -> String {
    let bytes = path.as_bytes();
    if bytes.is_empty() {
        return ".".to_string();
    }
    let mut i = bytes.len() - 1;
    loop {
        if bytes[i] == b'/' {
            return go_clean(&path[..i + 1]);
        }
        if i == 0 {
            return go_clean(&path[..0]);
        }
        i -= 1;
    }
}

/// Go `filepath.Base`: the last element; trailing slashes stripped; "." for
/// empty, "/" for all-slash.
fn go_base(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let mut p = path;
    while !p.is_empty() && p.as_bytes()[p.len() - 1] == b'/' {
        p = &p[..p.len() - 1];
    }
    if let Some(idx) = p.rfind('/') {
        p = &p[idx + 1..];
    }
    if p.is_empty() {
        return "/".to_string();
    }
    p.to_string()
}

/// Go `filepath.Rel` for the unix case (Separator `/`, no volume names,
/// case-sensitive). Both paths are Cleaned first, as Go does.
fn go_rel(basepath: &str, targpath: &str) -> Result<String, String> {
    let base = go_clean(basepath);
    let targ = go_clean(targpath);
    if targ == base {
        return Ok(".".to_string());
    }

    let mut base = base;
    if base == "." {
        base = String::new();
    }

    let base_b = base.as_bytes();
    let targ_b = targ.as_bytes();
    let base_slashed = !base_b.is_empty() && base_b[0] == b'/';
    let targ_slashed = !targ_b.is_empty() && targ_b[0] == b'/';
    if base_slashed != targ_slashed {
        return Err(format!(
            "Rel: can't make {targpath} relative to {basepath}"
        ));
    }

    let bl = base_b.len();
    let tl = targ_b.len();
    let (mut b0, mut bi, mut t0, mut ti) = (0usize, 0usize, 0usize, 0usize);
    loop {
        while bi < bl && base_b[bi] != b'/' {
            bi += 1;
        }
        while ti < tl && targ_b[ti] != b'/' {
            ti += 1;
        }
        if targ_b[t0..ti] != base_b[b0..bi] {
            break;
        }
        if bi < bl {
            bi += 1;
        }
        if ti < tl {
            ti += 1;
        }
        b0 = bi;
        t0 = ti;
    }
    if &base_b[b0..bi] == b".." {
        return Err(format!(
            "Rel: can't make {targpath} relative to {basepath}"
        ));
    }

    if b0 != bl {
        // Base elements left: must go up (`..`) before going down.
        let seps = base[b0..bl].matches('/').count();
        let mut buf = String::from("..");
        for _ in 0..seps {
            buf.push_str("/..");
        }
        if t0 != tl {
            buf.push('/');
            buf.push_str(&targ[t0..]);
        }
        return Ok(buf);
    }
    Ok(targ[t0..].to_string())
}

#[cfg(test)]
#[path = "trash_tests.rs"]
mod trash_tests;
