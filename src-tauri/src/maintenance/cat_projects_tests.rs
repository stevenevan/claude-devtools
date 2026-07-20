//! Ported from `internal/maintenance/cat_projects_test.go`.

use std::collections::HashMap;

use chrono::{Duration, Utc};

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::scan_category;
use crate::maintenance::types::{Candidate, CategorySpec};

#[test]
fn test_scan_projects() {
    let tmp = TempDir::new("projects");
    let root = tmp.path();
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);
    // Encoded project dir "-Users-me-proj" → decoded "/Users/me/proj".
    let proj_dir = root.join("projects").join("-Users-me-proj");

    let old = write_aged(&proj_dir.join("ses-old.jsonl"), "{}", days_before(now_local, 120));
    write_aged(&proj_dir.join("ses-pinned.jsonl"), "{}", days_before(now_local, 120));
    write_aged(&proj_dir.join("ses-fresh.jsonl"), "{}", days_before(now_local, 2));

    let spec = CategorySpec {
        id: "projects".to_string(),
        root: root.to_string_lossy().into_owned(),
        now,
        cutoff: Some((now_local - Duration::days(90)).with_timezone(&Utc)),
        pinned: vec!["ses-pinned".to_string()],
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();
    assert_eq!(cands.len(), 2, "fresh excluded: {cands:?}");

    let by_name: HashMap<String, Candidate> = cands
        .iter()
        .map(|c| (c.meta["sessionId"].clone(), c.clone()))
        .collect();

    assert!(!by_name.contains_key("ses-fresh"), "fresh session excluded");
    assert_eq!(by_name["ses-old"].path, old);
    assert_eq!(by_name["ses-old"].group, "/Users/me/proj");
    assert_eq!(by_name["ses-pinned"].meta.get("pinned").map(String::as_str), Some("true"));
    assert_ne!(by_name["ses-old"].meta.get("pinned").map(String::as_str), Some("true"));
}
