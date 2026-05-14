use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Canonical, startup-captured `~/.claude/projects/` path.
///
/// Sprint 64: captured ONCE at app `.setup()` so a symlink swap between
/// startup and a spawned `tokio` task cannot widen the IPC trust boundary.
/// The struct holds `Arc<PathBuf>` so it can be cheaply cloned into spawned
/// tasks; the held path is already-canonical (passed pre-canonical to
/// `path_util::confine`).
pub struct ClaudeRoot(Arc<PathBuf>);

impl ClaudeRoot {
    /// Build by canonicalizing `~/.claude/projects` when it exists, otherwise
    /// canonicalize the parent (`~/.claude`) and lexically join "projects".
    /// First-run installs may not yet have the `projects/` subdirectory; this
    /// keeps `start_watcher` happy while preserving the canonical-prefix
    /// guarantee `confine()` relies on.
    pub fn new() -> Self {
        let projects = match crate::watcher::resolve_claude_dir() {
            Some(claude_dir) => {
                let candidate = claude_dir.join("projects");
                std::fs::canonicalize(&candidate).unwrap_or_else(|_| {
                    let canonical_parent = std::fs::canonicalize(&claude_dir)
                        .unwrap_or(claude_dir);
                    canonical_parent.join("projects")
                })
            }
            None => PathBuf::from(""),
        };
        Self(Arc::new(projects))
    }

    pub fn canonical_projects(&self) -> &Path {
        self.0.as_path()
    }

    #[cfg(test)]
    pub fn for_test(path: PathBuf) -> Self {
        Self(Arc::new(path))
    }
}

impl Default for ClaudeRoot {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::path_util::{
        confine, resolve_session_path, ERR_ESCAPES_ROOT,
    };
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    const VALID_SESSION: &str = "0123abcd-4567-89ef-abcd-0123456789ab";
    const VALID_PROJECT: &str = "-Users-name-project";

    fn canonical_tempdir() -> (TempDir, PathBuf) {
        let dir = TempDir::new().expect("tempdir");
        let canonical = fs::canonicalize(dir.path()).expect("canonicalize tempdir");
        (dir, canonical)
    }

    /// Test A: confine rejects a candidate that, after canonicalization,
    /// resolves outside the captured canonical root via a planted symlink.
    #[cfg(unix)]
    #[test]
    fn confine_rejects_post_swap_symlink_candidate() {
        let (_root_keep, canonical_root) = canonical_tempdir();
        let (target_keep, canonical_target) = canonical_tempdir();
        // Plant a file outside root, then symlink it inside root.
        let outside_file = canonical_target.join("secret.txt");
        fs::write(&outside_file, b"secret").unwrap();
        let symlink_path = canonical_root.join("link.jsonl");
        symlink(&outside_file, &symlink_path).unwrap();

        let result = confine(symlink_path.clone(), &canonical_root);
        assert_eq!(
            result.unwrap_err(),
            ERR_ESCAPES_ROOT,
            "symlink escaping root must be rejected"
        );
        // Anchor the lifetime so canonical_target isn't dropped early.
        drop(target_keep);
    }

    /// Test B: pre-canonical root is honored at the time confine was given
    /// it. After capture, a swap of the unrelated path doesn't change the
    /// captured-root comparison.
    #[cfg(unix)]
    #[test]
    fn confine_uses_captured_canonical_root_not_live_derive() {
        let (root_b_keep, canonical_b) = canonical_tempdir();
        let (root_c_keep, canonical_c) = canonical_tempdir();
        // Captured canonical root is B.
        let captured_root = canonical_b.clone();

        // Plant a real candidate inside C and confine against captured_root (B).
        let candidate_in_c = canonical_c.join("subdir");
        fs::create_dir_all(&candidate_in_c).unwrap();

        let result = confine(candidate_in_c, &captured_root);
        assert_eq!(
            result.unwrap_err(),
            ERR_ESCAPES_ROOT,
            "candidate outside captured canonical root must be rejected"
        );
        drop(root_b_keep);
        drop(root_c_keep);
    }

    /// Test C (end-to-end): resolve_session_path with a captured canonical
    /// root rejects a session that symlinks outside the root.
    #[cfg(unix)]
    #[test]
    fn resolve_session_path_with_captured_root_rejects_swap() {
        let (_root_keep, canonical_root) = canonical_tempdir();
        let (target_keep, canonical_target) = canonical_tempdir();

        // Build the on-disk layout that resolve_session_path expects:
        // <root>/<project_id>/<session_id>.jsonl
        let project_dir = canonical_root.join(VALID_PROJECT);
        fs::create_dir_all(&project_dir).unwrap();

        // Plant the .jsonl as a symlink pointing OUTSIDE the captured root.
        let outside_file = canonical_target.join("not-a-session.jsonl");
        fs::write(&outside_file, b"{}").unwrap();
        let session_path = project_dir.join(format!("{VALID_SESSION}.jsonl"));
        symlink(&outside_file, &session_path).unwrap();

        let result = resolve_session_path(&canonical_root, VALID_PROJECT, VALID_SESSION);
        assert_eq!(
            result.unwrap_err(),
            ERR_ESCAPES_ROOT,
            "end-to-end: resolve_session_path must reject a symlink-out candidate"
        );
        drop(target_keep);
    }

    /// Sanity: when nothing escapes, resolve_session_path returns the
    /// candidate verbatim (canonicalized).
    #[cfg(unix)]
    #[test]
    fn resolve_session_path_accepts_legitimate_session() {
        let (_root_keep, canonical_root) = canonical_tempdir();
        let project_dir = canonical_root.join(VALID_PROJECT);
        fs::create_dir_all(&project_dir).unwrap();
        let session_path = project_dir.join(format!("{VALID_SESSION}.jsonl"));
        fs::write(&session_path, b"{}").unwrap();

        let result = resolve_session_path(&canonical_root, VALID_PROJECT, VALID_SESSION);
        let resolved = result.expect("legitimate session must resolve");
        let canonical_session = fs::canonicalize(&session_path).unwrap();
        assert_eq!(resolved, canonical_session);
    }

    #[test]
    fn for_test_constructor_stores_path() {
        let p = PathBuf::from("/tmp/xyz");
        let root = ClaudeRoot::for_test(p.clone());
        assert_eq!(root.canonical_projects(), p.as_path());
    }
}
