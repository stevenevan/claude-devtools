//! Ported from `internal/maintenance/category_test.go`.

use super::maint_test_support::*;
use super::{cutoff_default, is_today, older_than, open_dir_no_symlink, subtree_stats};
use crate::maintenance::types::{go_zero_time, CategorySpec};

use chrono::{DateTime, Local, TimeZone, Utc};

// Loads the committed cutoff fixture for every registered category.
#[test]
fn cutoff_default_matches_go_golden() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/parity/maintenance_cutoffs.golden.json"
    );
    let raw = std::fs::read_to_string(path).unwrap_or_else(|e| {
        panic!("read committed maintenance-cutoff fixture {path}: {e}")
    });
    let pairs: Vec<(String, i64)> =
        serde_json::from_str(&raw).expect("parse maintenance_cutoffs.golden.json");
    assert!(!pairs.is_empty(), "no cutoff pairs");
    for (id, days) in &pairs {
        assert_eq!(cutoff_default(id), *days, "cutoff mismatch for {id:?}");
    }
}

fn local(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
    Local
        .with_ymd_and_hms(y, mo, d, h, mi, 0)
        .unwrap()
        .with_timezone(&Utc)
}

#[test]
fn test_is_today() {
    let now = local(2026, 7, 10, 12, 0);
    assert!(is_today(local(2026, 7, 10, 0, 1), now), "same day earlier");
    assert!(is_today(local(2026, 7, 10, 23, 59), now), "same day later");
    assert!(!is_today(local(2026, 7, 9, 23, 59), now), "yesterday");
    assert!(!is_today(local(2026, 7, 11, 0, 0), now), "tomorrow");
}

#[test]
fn test_older_than() {
    let now = local(2026, 7, 10, 12, 0);
    let cutoff = now - chrono::Duration::days(30);
    let spec = CategorySpec {
        now,
        cutoff: Some(cutoff),
        ..Default::default()
    };

    assert!(!older_than(now, &spec), "today's file must never be a candidate");
    assert!(
        !older_than(now - chrono::Duration::days(10), &spec),
        "10-day-old file is inside a 30-day cutoff"
    );
    assert!(
        older_than(now - chrono::Duration::days(40), &spec),
        "40-day-old file is past a 30-day cutoff"
    );

    // Zero cutoff = no age gate, but still excludes today.
    let no_gate = CategorySpec {
        now,
        cutoff: None,
        ..Default::default()
    };
    assert!(
        older_than(now - chrono::Duration::days(1), &no_gate),
        "zero cutoff: any non-today file is a candidate"
    );
    assert!(!older_than(now, &no_gate), "zero cutoff: today's file still excluded");
}

#[test]
fn test_open_dir_no_symlink_refuses_symlink() {
    let tmp = TempDir::new("opendir");
    let root = tmp.path();
    let real = root.join("real");
    std::fs::create_dir_all(real.join("child")).unwrap();
    let link = root.join("link");

    #[cfg(unix)]
    {
        if std::os::unix::fs::symlink(&real, &link).is_err() {
            return; // symlink unsupported — skip like the Go test
        }
        let (entries, ok) = open_dir_no_symlink(&link).unwrap();
        assert!(!ok && entries.is_empty(), "symlinked dir must be refused");
    }

    let (_entries, ok) = open_dir_no_symlink(&real).unwrap();
    assert!(ok, "real dir must open");

    let (entries, ok) = open_dir_no_symlink(&root.join("missing")).unwrap();
    assert!(!ok && entries.is_empty(), "missing dir yields (empty,false)");
}

#[test]
fn test_subtree_stats() {
    let tmp = TempDir::new("subtree");
    let root = tmp.path();
    write_file(&root.join("a.txt"), "hello"); // 5
    write_file(&root.join("sub").join("b.txt"), "hi"); // 2

    let (bytes, files, newest) = subtree_stats(root);
    assert_eq!(bytes, 7);
    assert_eq!(files, 2);
    assert_ne!(newest, go_zero_time(), "newest mtime not set");
}
