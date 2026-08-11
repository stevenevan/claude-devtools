use std::collections::BTreeMap;

use chrono::{TimeZone, Utc};

use super::*;
use crate::maintenance::cat_junk::SimpleJunkKind;
use crate::maintenance::category::maint_test_support::{
    days_before, set_mtime, test_now, write_aged, write_file, TempDir,
};

fn candidate(path: &str, bytes: i64) -> SimpleCleanupCandidate {
    SimpleCleanupCandidate {
        category_id: "file-history".to_string(),
        candidate: Candidate {
            path: path.to_string(),
            bytes,
            files: 1,
            mod_time: Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap(),
            reason: "test".to_string(),
            group: String::new(),
            meta: BTreeMap::new(),
        },
    }
}

#[test]
fn rejects_categories_outside_the_simple_allowlist() {
    let result = scan_allowlist(&[CategorySpec {
        id: "plugins".to_string(),
        ..Default::default()
    }]);

    let error = result.expect_err("plugins must not enter Simple cleanup");
    assert!(error.contains("not allowed in simple cleanup"), "{error}");
}

#[test]
fn scans_all_three_junk_families_in_one_simple_result() {
    let tmp = TempDir::new("simple-junk");
    let root = tmp.path();
    let now_local = test_now();
    let old = days_before(now_local, 5);

    write_file(&root.join(".DS_Store"), "x");
    write_aged(&root.join("stale.tmp"), "x", old);
    std::fs::create_dir_all(root.join("empty").join("nested")).unwrap();
    set_mtime(&root.join("empty").join("nested"), old);
    set_mtime(&root.join("empty"), old);

    let spec = CategorySpec {
        id: "junk-tmp".to_string(),
        root: root.to_string_lossy().into_owned(),
        app_data: root.join("app-data").to_string_lossy().into_owned(),
        now: now_local.with_timezone(&Utc),
        cutoff: Some((now_local - chrono::Duration::days(1)).with_timezone(&Utc)),
        ..Default::default()
    };
    let result = crate::maintenance::cat_junk::scan_simple_junk(&spec).unwrap();
    assert!(result
        .iter()
        .any(|item| item.kind == SimpleJunkKind::DsStore));
    assert!(result.iter().any(|item| item.kind == SimpleJunkKind::Tmp));
    assert!(result
        .iter()
        .any(|item| item.kind == SimpleJunkKind::EmptyDir));
}

#[test]
fn normalizes_duplicates_and_nested_candidates() {
    let normalized = normalize_candidates(vec![
        candidate("/root/a/child", 2),
        candidate("/root/a", 4),
        candidate("/root/a", 4),
        candidate("/root/b", 8),
    ]);

    assert_eq!(
        normalized
            .iter()
            .map(|item| item.candidate.path.as_str())
            .collect::<Vec<_>>(),
        ["/root/a", "/root/b"]
    );
}

#[test]
fn snapshot_comparison_rejects_changed_metadata() {
    let expected = vec![candidate("/root/a", 4)];
    let mut actual = expected.clone();
    actual[0].candidate.bytes = 5;
    assert!(!same_snapshot(&expected, &actual));
    assert!(same_snapshot(&expected, &expected));
}

#[test]
fn batches_are_capped_at_the_trash_engine_limit() {
    assert_eq!(batch_sizes(0), Vec::<usize>::new());
    assert_eq!(batch_sizes(500), vec![500]);
    assert_eq!(batch_sizes(1001), vec![500, 500, 1]);
}
