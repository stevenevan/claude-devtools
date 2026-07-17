//! Ported from `internal/maintenance/cat_logs_caches_test.go`.

use std::collections::HashMap;
use std::path::Path;

use chrono::Utc;

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::scan_category;
use crate::maintenance::types::{Candidate, CategorySpec};

fn spec(id: &str, root: &Path) -> CategorySpec {
    CategorySpec {
        id: id.to_string(),
        root: root.to_string_lossy().into_owned(),
        now: Utc::now(),
        ..Default::default()
    }
}

#[test]
fn test_scan_logs_and_daemon() {
    let tmp = TempDir::new("logs");
    let root = tmp.path();
    write_file(&root.join("logs").join("devtools.2026-06-22.jsonl"), "a");
    write_file(&root.join("daemon.log"), "d");
    write_file(&root.join("daemon.log.1"), "d1");

    let logs = scan_category(&spec("logs", root)).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].meta["owner"], "app");

    let daemon = scan_category(&spec("logs-daemon", root)).unwrap();
    assert_eq!(daemon.len(), 2, "daemon.log + .1");
    for c in &daemon {
        assert_eq!(c.meta["owner"], "daemon");
    }
}

#[test]
fn test_scan_caches() {
    let tmp = TempDir::new("caches");
    let root = tmp.path();
    write_file(&root.join("cache").join("changelog.md"), "log");
    write_file(&root.join("stats-cache.json"), "{}");
    write_file(&root.join("paste-cache").join("blob1"), "pasted secret");
    write_file(&root.join("some-unknown-cache.json"), "x"); // must NOT be a candidate

    let cands = scan_category(&spec("caches", root)).unwrap();

    let mut names: HashMap<String, Candidate> = HashMap::new();
    for c in &cands {
        let base = Path::new(&c.path).file_name().unwrap().to_string_lossy().into_owned();
        assert_ne!(base, "some-unknown-cache.json", "allowlist only");
        names.insert(base, c.clone());
    }
    assert!(names.contains_key("changelog.md"));
    assert!(!names["changelog.md"].meta["regeneratedBy"].is_empty());
    assert_eq!(names["blob1"].meta["sensitive"], "true");
}
