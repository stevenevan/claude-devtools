//! Ported from `internal/maintenance/cat_filehistory_test.go`.

use std::collections::HashMap;

use chrono::{Duration, Utc};

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::scan_category;
use crate::maintenance::types::CategorySpec;

#[test]
fn test_scan_file_history() {
    let tmp = TempDir::new("file-history");
    let root = tmp.path();
    let dir = root.join("file-history");
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);

    // Old UUID dir: newest snapshot 40 days ago → stale. The UUID dir itself is
    // also backdated (subtree_stats' newest includes the dir's own mtime).
    let stale = "aaaaaaaa-0000-0000-0000-000000000001";
    let stale_age = days_before(now_local, 40);
    write_aged(&dir.join(stale).join("v1"), "snap1", stale_age);
    set_mtime(&dir.join(stale), stale_age);

    // Fresh UUID dir: edited 2 days ago → excluded.
    let fresh = "bbbbbbbb-0000-0000-0000-000000000002";
    write_aged(&dir.join(fresh).join("v1"), "snap1", days_before(now_local, 2));

    // Empty UUID dir (no snapshot files) → empty candidate regardless of age.
    let empty = "cccccccc-0000-0000-0000-000000000003";
    std::fs::create_dir_all(dir.join(empty)).unwrap();

    let spec = CategorySpec {
        id: "file-history".to_string(),
        root: root.to_string_lossy().into_owned(),
        now,
        cutoff: Some((now_local - Duration::days(30)).with_timezone(&Utc)),
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();
    assert_eq!(cands.len(), 2, "stale + empty: {cands:?}");

    let groups: HashMap<String, String> = cands
        .iter()
        .map(|c| (c.meta["uuid"].clone(), c.group.clone()))
        .collect();
    assert_eq!(groups[stale], "stale");
    assert_eq!(groups[empty], "empty");
    assert!(!groups.contains_key(fresh), "fresh UUID dir excluded");
}
