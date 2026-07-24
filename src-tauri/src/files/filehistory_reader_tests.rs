//! `tempfile` is not a dep → use `std::env::temp_dir()` + a unique subdir
//! (never touches real `~/.claude` files), matching `claude_read_tests.rs`.

use std::fs;
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
    let dir = std::env::temp_dir().join(format!(
        "claude-filehistory-test-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

#[test]
fn list_file_history_groups_by_uuid_and_hash() {
    let root = make_temp_root();
    let uuid_dir = root.join("file-history").join("session-1");
    fs::create_dir_all(&uuid_dir).unwrap();
    fs::write(uuid_dir.join("aaaa@v1"), "aaaa version one").unwrap();
    fs::write(uuid_dir.join("aaaa@v2"), "aaaa version two!").unwrap();
    fs::write(uuid_dir.join("bbbb@v1"), "bbbb version one").unwrap();
    fs::write(uuid_dir.join(".DS_Store"), "junk").unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let groups = list_file_history(&root_str).expect("list_file_history");

    assert_eq!(groups.len(), 2, "want aaaa + bbbb groups, got {groups:?}");

    let aaaa = groups
        .iter()
        .find(|g| g.file_hash == "aaaa")
        .expect("aaaa group");
    assert_eq!(aaaa.session_uuid, "session-1");
    assert_eq!(aaaa.versions, vec![1, 2]);

    let expected_meta = fs::metadata(uuid_dir.join("aaaa@v2")).unwrap();
    assert_eq!(aaaa.latest_size, expected_meta.len() as i64);
    assert!(aaaa.latest_mtime > 0, "latest_mtime must be positive");

    let bbbb = groups
        .iter()
        .find(|g| g.file_hash == "bbbb")
        .expect("bbbb group");
    assert_eq!(bbbb.versions, vec![1]);
}

#[test]
fn list_file_history_missing_dir_is_empty() {
    let root = make_temp_root();
    let root_str = root.to_string_lossy().into_owned();
    let groups = list_file_history(&root_str).expect("list_file_history");
    assert!(groups.is_empty());
}

#[test]
fn read_checkpoint_returns_exact_bytes() {
    let root = make_temp_root();
    let uuid_dir = root.join("file-history").join("session-1");
    fs::create_dir_all(&uuid_dir).unwrap();
    fs::write(uuid_dir.join("aaaa@v2"), "aaaa version two!").unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let content =
        read_checkpoint(&root_str, "session-1", "aaaa", 2).expect("read_checkpoint");
    assert_eq!(content, "aaaa version two!");
}

#[test]
fn read_checkpoint_rejects_traversal_ids() {
    let root = make_temp_root();
    fs::create_dir_all(root.join("file-history").join("session-1")).unwrap();
    let root_str = root.to_string_lossy().into_owned();

    assert!(read_checkpoint(&root_str, "../evil", "aaaa", 1).is_err());
    assert!(read_checkpoint(&root_str, "session-1", "a/b", 1).is_err());
}
