//! `tempfile` is not a dep → use `std::env::temp_dir()` + a unique subdir
//! (never touches real `~/.claude` files), matching `skills_inventory_tests.rs`.

use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;

fn make_temp_root() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("claude-read-test-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

#[test]
fn list_dir_files_filters_and_sorts() {
    let root = make_temp_root();
    let sub = root.join("sub");
    fs::create_dir_all(sub.join("nested")).unwrap();
    fs::write(sub.join("b.txt"), "bbbb").unwrap();
    fs::write(sub.join("a.txt"), "aa").unwrap();
    fs::write(sub.join(".hidden.txt"), "hidden").unwrap();
    fs::write(sub.join(".DS_Store"), "junk").unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let entries = list_dir_files(&root_str, "sub", "txt").expect("list_dir_files");

    assert_eq!(entries.len(), 2, "want a.txt + b.txt only, got {entries:?}");
    assert_eq!(entries[0].name, "a.txt");
    assert_eq!(entries[0].size_bytes, 2);
    assert_eq!(entries[1].name, "b.txt");
    assert_eq!(entries[1].size_bytes, 4);
    for e in &entries {
        assert!(e.mtime > 0, "mtime must be a positive epoch-ms value");
    }
}

#[test]
fn list_dir_files_missing_subdir_is_empty() {
    let root = make_temp_root();
    let root_str = root.to_string_lossy().into_owned();
    let entries = list_dir_files(&root_str, "does-not-exist", "txt").expect("list_dir_files");
    assert!(entries.is_empty());
}

#[test]
fn read_confined_file_returns_exact_bytes() {
    let root = make_temp_root();
    let sub = root.join("sub");
    fs::create_dir_all(&sub).unwrap();
    fs::write(sub.join("a.txt"), "hello world").unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let bytes = read_confined_file(&root_str, "sub", "a.txt").expect("read_confined_file");
    assert_eq!(bytes, b"hello world");
}

#[test]
fn read_confined_file_rejects_traversal_names() {
    let root = make_temp_root();
    fs::create_dir_all(root.join("sub")).unwrap();
    let root_str = root.to_string_lossy().into_owned();

    assert!(read_confined_file(&root_str, "sub", "../secret").is_err());
    assert!(read_confined_file(&root_str, "sub", "a/b").is_err());
}

#[test]
fn read_confined_file_rejects_symlink_escape() {
    let base = make_temp_root();
    let root = base.join("claude");
    let sub = root.join("sub");
    fs::create_dir_all(&sub).unwrap();

    let outside = base.join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.txt"), "do not read").unwrap();

    symlink(outside.join("secret.txt"), sub.join("link")).unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let result = read_confined_file(&root_str, "sub", "link");
    assert!(
        result.is_err(),
        "a symlink escaping the root must be rejected"
    );
}
