//! Ported from `internal/maintenance/scan_test.go`. The cancellation tests
//! (`countingCtx`/`cancelAfterCtx`) exercise Go's `context.Context` plumbing;
//! the Rust `scan_claude_dir` signature is ctx-free (the service owns
//! cancellation), so only the symlink-refusal and unreadable-dir invariants port.

#![cfg(unix)]

use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::Path;

use super::scan_claude_dir;
use crate::maintenance::category::maint_test_support::{write_file, TempDir};
use crate::maintenance::types::DirUsage;

fn find_usage<'a>(usages: &'a [DirUsage], path: &Path) -> Option<&'a DirUsage> {
    let want = path.to_string_lossy();
    usages.iter().find(|u| u.path == want)
}

fn write_bytes(path: &Path, n: usize) {
    write_file(path, &"a".repeat(n));
}

// Covers two SEC invariants at once: a child that is itself a symlink pointing
// at a directory OUTSIDE the scanned tree (its bytes must never appear), and a
// symlink cycle nested inside a real child (must not hang or double-count).
#[test]
fn scan_claude_dir_symlink_child_never_followed() {
    let root_tmp = TempDir::new("scan-root");
    let outside_tmp = TempDir::new("scan-outside");
    let root = root_tmp.path();
    let outside = outside_tmp.path();

    write_bytes(&outside.join("target").join("bigfile.bin"), 5000);

    write_bytes(&root.join("childA").join("file1.txt"), 10);
    write_bytes(&root.join("childA").join("sub").join("file2.txt"), 20);
    symlink(root.join("childA"), root.join("childA").join("sub").join("cyclelink")).unwrap();

    symlink(outside.join("target"), root.join("childB")).unwrap();

    let usages = scan_claude_dir(&[root.to_string_lossy().into_owned()], None).unwrap();

    let child_a = find_usage(&usages, &root.join("childA")).expect("childA row");
    assert!(!child_a.is_symlink, "childA is a real dir");
    assert_eq!(child_a.bytes, 30, "cycle link must not be followed/double-counted");
    assert_eq!(child_a.files, 2);

    let child_b = find_usage(&usages, &root.join("childB")).expect("childB row");
    assert!(child_b.is_symlink, "childB is a symlink");
    assert_eq!(child_b.bytes, 0, "symlink target's bytes must never be counted");
}

// A permission-denied subdirectory surfaces via Err on its containing child,
// without aborting the scan of sibling children.
#[test]
fn scan_claude_dir_unreadable_dir_does_not_abort() {
    let root_tmp = TempDir::new("scan-unreadable");
    let root = root_tmp.path();
    write_bytes(&root.join("childOK").join("file.txt"), 5);

    let unreadable = root.join("childC").join("locked");
    std::fs::create_dir_all(&unreadable).unwrap();
    std::fs::set_permissions(&unreadable, std::fs::Permissions::from_mode(0o000)).unwrap();

    // Root (or a permissive FS) can still read a 000 dir — skip like the Go test.
    if std::fs::read_dir(&unreadable).is_ok() {
        let _ = std::fs::set_permissions(&unreadable, std::fs::Permissions::from_mode(0o755));
        return;
    }

    let usages = scan_claude_dir(&[root.to_string_lossy().into_owned()], None).unwrap();
    let _ = std::fs::set_permissions(&unreadable, std::fs::Permissions::from_mode(0o755));

    let child_c = find_usage(&usages, &root.join("childC")).expect("childC row");
    assert!(!child_c.err.is_empty(), "childC surfaces the permission error");

    let child_ok = find_usage(&usages, &root.join("childOK")).expect("childOK row");
    assert_eq!(child_ok.bytes, 5);
    assert!(child_ok.err.is_empty());
}
