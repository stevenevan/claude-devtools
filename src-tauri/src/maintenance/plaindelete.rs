//! Ports `internal/maintenance/plaindelete.go` — the IRREVERSIBLE plain-delete
//! counterpart to `trash_items`: no trash copy, no receipt. Used ONLY for
//! regenerable diagnostics/caches (logs, caches) where a trash copy would
//! wrongly extend retention. Shares `trash`'s confinement discipline via
//! `validate_leaves` (absolute, symlink-safe parent confine, root/appData/trash
//! self-nuke refusal) and, like `trash_items`, re-Lstats each leaf immediately
//! before mutating it to close the validate→act TOCTOU window. A symlinked leaf
//! is refused outright — never remove/truncate through a link.

use std::fs;

use super::trash::{canonicalize_roots, resolve_app_data_dir, validate_leaves};

/// truncate=true zeroes the file in place (`set_len(0)`) so a daemon holding the
/// fd keeps writing to the same inode; truncate=false removes it.
pub fn clear_files(
    roots: &[String],
    app_data_dir: &str,
    paths: &[String],
    truncate: bool,
) -> Result<(), String> {
    if paths.is_empty() {
        return Err("maintenance: no paths given".to_string());
    }

    // Resolve appData first (creating it) so a roots entry pointing at a
    // not-yet-existing appData dir still canonicalizes.
    let canon_app_data = resolve_app_data_dir(app_data_dir, true)?;
    let canon_roots = canonicalize_roots(roots)?;

    let leaves = validate_leaves(&canon_roots, &canon_app_data, paths)?;
    for leaf in &leaves {
        if leaf.is_symlink {
            return Err(format!(
                "maintenance: refusing to clear a symlink {:?}",
                leaf.orig_path
            ));
        }
    }

    for leaf in &leaves {
        // TOCTOU parity with trash's pre-move re-Lstat: refuse a leaf that
        // vanished or became a symlink between validation and the mutation.
        let lst = fs::symlink_metadata(&leaf.orig_path)
            .map_err(|e| format!("maintenance: {:?} vanished before clear: {e}", leaf.orig_path))?;
        if lst.file_type().is_symlink() {
            return Err(format!(
                "maintenance: {:?} became a symlink; refusing",
                leaf.orig_path
            ));
        }

        if truncate {
            let file = fs::OpenOptions::new()
                .write(true)
                .open(&leaf.orig_path)
                .map_err(|e| format!("maintenance: truncate {:?}: {e}", leaf.orig_path))?;
            file.set_len(0)
                .map_err(|e| format!("maintenance: truncate {:?}: {e}", leaf.orig_path))?;
            continue;
        }

        fs::remove_file(&leaf.orig_path)
            .map_err(|e| format!("maintenance: remove {:?}: {e}", leaf.orig_path))?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "plaindelete_tests.rs"]
mod plaindelete_tests;
