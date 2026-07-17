//! Ported from `internal/maintenance/cat_junk_test.go`.

use chrono::{Duration, Utc};

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::scan_category;
use crate::maintenance::types::CategorySpec;

#[test]
fn test_scan_junk_dsstore() {
    let tmp = TempDir::new("junk-dsstore");
    let root = tmp.path();
    let now = test_now().with_timezone(&Utc);

    write_file(&root.join("agents").join("skills").join(".DS_Store"), "x");
    write_file(&root.join(".DS_Store"), "x");

    let app_data = root.join(".claude-devtools");
    write_file(&app_data.join("trash").join(".DS_Store"), "x");

    let spec = CategorySpec {
        id: "junk-dsstore".to_string(),
        root: root.to_string_lossy().into_owned(),
        app_data: app_data.to_string_lossy().into_owned(),
        now,
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();
    assert_eq!(cands.len(), 2, "nested + root-level .DS_Store: {cands:?}");
    let app_data_prefix = app_data.to_string_lossy().into_owned();
    for c in &cands {
        assert!(!c.path.starts_with(&app_data_prefix), "AppData excluded: {}", c.path);
    }
}

#[test]
fn test_scan_junk_tmp() {
    let tmp = TempDir::new("junk-tmp");
    let root = tmp.path();
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);

    let stale = write_aged(
        &root.join("shell-snapshots").join("old.tmp"),
        "x",
        days_before(now_local, 5),
    );
    write_aged(&root.join("shell-snapshots").join("new.tmp"), "x", now_local); // today

    let spec = CategorySpec {
        id: "junk-tmp".to_string(),
        root: root.to_string_lossy().into_owned(),
        now,
        cutoff: Some((now_local - Duration::days(1)).with_timezone(&Utc)),
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();
    assert_eq!(cands.len(), 1, "only the stale .tmp: {cands:?}");
    assert_eq!(cands[0].path, stale);
}

#[test]
fn test_scan_junk_empty_dirs() {
    let tmp = TempDir::new("junk-empty");
    let root = tmp.path();
    let now = test_now().with_timezone(&Utc);

    write_file(&root.join("config.json"), "{}"); // keeps root non-collapsible

    for name in ["projects", "todos", "plugins"] {
        std::fs::create_dir_all(root.join(name)).unwrap();
    }
    std::fs::create_dir_all(root.join("a").join("b").join("c")).unwrap();

    let spec = CategorySpec {
        id: "junk-emptydirs".to_string(),
        root: root.to_string_lossy().into_owned(),
        now,
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();
    assert_eq!(cands.len(), 1, "topmost empty dir only: {cands:?}");
    assert_eq!(cands[0].path, root.join("a").to_string_lossy());
}
