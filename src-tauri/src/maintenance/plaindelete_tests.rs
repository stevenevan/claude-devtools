//! Ports `plaindelete_test.go`. env::temp_dir + unique subdirs; never touches
//! real `~/.claude`.

use super::clear_files;

use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn make_temp_dir() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("clear-test-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn write_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

#[test]
fn clear_files_delete() {
    let root = make_temp_dir();
    let app_data = root.join(".appdata");
    let f = root.join("logs").join("old.jsonl");
    write_file(&f, "log");

    clear_files(&[s(&root), s(&app_data)], &s(&app_data), &[s(&f)], false).expect("clear");
    assert!(fs::symlink_metadata(&f).is_err(), "delete must remove the file");
}

#[test]
fn clear_files_truncate_keeps_inode() {
    let root = make_temp_dir();
    let app_data = root.join(".appdata");
    let daemon = root.join("daemon.log");
    fs::write(&daemon, "lots of log data").unwrap();

    clear_files(&[s(&root), s(&app_data)], &s(&app_data), &[s(&daemon)], true).expect("truncate");
    let after = fs::metadata(&daemon).expect("truncate must keep the file");
    assert_eq!(after.len(), 0, "truncate must zero the file");

    // A held fd keeps writing to the same inode: append after truncate works.
    use std::io::Write;
    let mut f = fs::OpenOptions::new().append(true).open(&daemon).unwrap();
    f.write_all(b"post-truncate write").unwrap();
    drop(f);
    assert!(
        fs::metadata(&daemon).unwrap().len() > 0,
        "append after truncate must land in the same file"
    );
}

#[test]
fn clear_files_refuses_symlink_and_escape() {
    let root = make_temp_dir();
    let app_data = root.join(".appdata");
    let outside = make_temp_dir().join("secret");
    write_file(&outside, "secret");

    // Out-of-root path refused.
    assert!(
        clear_files(&[s(&root), s(&app_data)], &s(&app_data), &[s(&outside)], false).is_err(),
        "out-of-root path must be refused"
    );

    // Symlinked leaf refused (never delete/truncate through a link).
    let target = root.join("target");
    write_file(&target, "data");
    let link = root.join("link");
    symlink(&target, &link).unwrap();
    assert!(
        clear_files(&[s(&root), s(&app_data)], &s(&app_data), &[s(&link)], false).is_err(),
        "symlinked leaf must be refused"
    );
    assert!(fs::metadata(&target).is_ok(), "symlink target must be untouched");
}
