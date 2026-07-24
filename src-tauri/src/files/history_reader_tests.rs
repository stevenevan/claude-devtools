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
        "claude-history-test-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

fn write_history(root: &PathBuf, lines: &[&str]) {
    fs::write(root.join("history.jsonl"), lines.join("\n")).unwrap();
}

#[test]
fn skips_malformed_lines() {
    let root = make_temp_root();
    write_history(
        &root,
        &[
            r#"{"display":"hello","project":"/a","timestamp":100,"pastedContents":{}}"#,
            "not json at all",
            r#"{"display":"world","project":"/b","timestamp":200,"pastedContents":{}}"#,
        ],
    );
    let page = read_history_page(&root.to_string_lossy(), None, 50, None).expect("read");
    assert_eq!(page.entries.len(), 2, "malformed line must be skipped");
    assert_eq!(page.total_matched, 2);
}

#[test]
fn sorts_newest_first() {
    let root = make_temp_root();
    write_history(
        &root,
        &[
            r#"{"display":"old","project":"/a","timestamp":100,"pastedContents":{}}"#,
            r#"{"display":"new","project":"/a","timestamp":300,"pastedContents":{}}"#,
            r#"{"display":"mid","project":"/a","timestamp":200,"pastedContents":{}}"#,
        ],
    );
    let page = read_history_page(&root.to_string_lossy(), None, 50, None).expect("read");
    let displays: Vec<&str> = page.entries.iter().map(|e| e.display.as_str()).collect();
    assert_eq!(displays, vec!["new", "mid", "old"]);
}

#[test]
fn pasted_count_is_object_key_count() {
    let root = make_temp_root();
    write_history(
        &root,
        &[
            r#"{"display":"a","project":"/a","timestamp":100,"pastedContents":{"1":{},"2":{}}}"#,
            r#"{"display":"b","project":"/a","timestamp":200,"pastedContents":{}}"#,
            r#"{"display":"c","project":"/a","timestamp":300}"#,
        ],
    );
    let page = read_history_page(&root.to_string_lossy(), None, 50, None).expect("read");
    let by_display = |d: &str| page.entries.iter().find(|e| e.display == d).unwrap();
    assert_eq!(by_display("a").pasted_count, 2);
    assert_eq!(by_display("b").pasted_count, 0);
    assert_eq!(
        by_display("c").pasted_count,
        0,
        "missing pastedContents -> 0"
    );
}

#[test]
fn query_is_case_insensitive_on_display_and_project() {
    let root = make_temp_root();
    write_history(
        &root,
        &[
            r#"{"display":"Fix the Bug","project":"/repo-a","timestamp":100,"pastedContents":{}}"#,
            r#"{"display":"unrelated","project":"/BUGTRACKER","timestamp":200,"pastedContents":{}}"#,
            r#"{"display":"nothing here","project":"/other","timestamp":300,"pastedContents":{}}"#,
        ],
    );
    let page = read_history_page(&root.to_string_lossy(), None, 50, Some("bug")).expect("read");
    assert_eq!(page.entries.len(), 2);
    assert_eq!(page.total_matched, 2);
}

#[test]
fn before_cursor_excludes_newer_entries_and_is_append_stable() {
    let root = make_temp_root();
    write_history(
        &root,
        &[
            r#"{"display":"a","project":"/a","timestamp":100,"pastedContents":{}}"#,
            r#"{"display":"b","project":"/a","timestamp":200,"pastedContents":{}}"#,
            r#"{"display":"c","project":"/a","timestamp":300,"pastedContents":{}}"#,
        ],
    );
    let page = read_history_page(&root.to_string_lossy(), Some(300), 50, None).expect("read");
    let displays: Vec<&str> = page.entries.iter().map(|e| e.display.as_str()).collect();
    assert_eq!(displays, vec!["b", "a"]);

    // Simulate a live append after the cursor was taken: the appended row
    // must never surface in a page cursored strictly before it.
    let mut contents = fs::read_to_string(root.join("history.jsonl")).unwrap();
    contents.push('\n');
    contents.push_str(r#"{"display":"d","project":"/a","timestamp":400,"pastedContents":{}}"#);
    fs::write(root.join("history.jsonl"), contents).unwrap();

    let page2 = read_history_page(&root.to_string_lossy(), Some(300), 50, None).expect("read");
    let displays2: Vec<&str> = page2.entries.iter().map(|e| e.display.as_str()).collect();
    assert_eq!(
        displays2,
        vec!["b", "a"],
        "append-stable: cursor unaffected by new tail rows"
    );
}

#[test]
fn limit_and_has_more() {
    let root = make_temp_root();
    write_history(
        &root,
        &[
            r#"{"display":"a","project":"/a","timestamp":100,"pastedContents":{}}"#,
            r#"{"display":"b","project":"/a","timestamp":200,"pastedContents":{}}"#,
            r#"{"display":"c","project":"/a","timestamp":300,"pastedContents":{}}"#,
        ],
    );
    let page = read_history_page(&root.to_string_lossy(), None, 2, None).expect("read");
    assert_eq!(page.entries.len(), 2);
    assert_eq!(page.total_matched, 3);
    assert!(page.has_more);

    let page2 = read_history_page(&root.to_string_lossy(), None, 3, None).expect("read");
    assert!(!page2.has_more);
}

#[test]
fn missing_history_file_is_empty_page() {
    let root = make_temp_root();
    let page = read_history_page(&root.to_string_lossy(), None, 50, None).expect("read");
    assert!(page.entries.is_empty());
    assert_eq!(page.total_matched, 0);
    assert!(!page.has_more);
}
