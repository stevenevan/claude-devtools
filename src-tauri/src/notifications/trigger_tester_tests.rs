//! Covers `list_jsonl_files` (newest-first mtime sort, non-jsonl + subdir
//! exclusion) using a temp dir — never real ~/.claude. Included by
//! trigger_tester.rs via `#[path] mod tests;`.

use super::*;
use std::time::{Duration, SystemTime};

#[test]
fn list_jsonl_files_newest_first() {
    let dir = std::env::temp_dir().join(format!(
        "trigger-tester-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();

    let base = SystemTime::now();
    // a (oldest) < b < c (newest).
    for (name, secs_ago) in [("a.jsonl", 20u64), ("b.jsonl", 10), ("c.jsonl", 0)] {
        let path = dir.join(name);
        std::fs::write(&path, b"{}").unwrap();
        let handle = std::fs::File::options().write(true).open(&path).unwrap();
        handle.set_modified(base - Duration::from_secs(secs_ago)).unwrap();
    }
    // Non-jsonl file and a subdirectory must be excluded.
    std::fs::write(dir.join("ignore.txt"), b"x").unwrap();
    std::fs::create_dir_all(dir.join("subdir")).unwrap();

    let files = list_jsonl_files(&dir).unwrap();
    let names: Vec<String> = files
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec!["c.jsonl", "b.jsonl", "a.jsonl"]);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_jsonl_files_errors_on_missing_dir() {
    let dir = std::env::temp_dir().join(format!("trigger-tester-missing-{}", uuid::Uuid::new_v4()));
    assert!(list_jsonl_files(&dir).is_err());
}
