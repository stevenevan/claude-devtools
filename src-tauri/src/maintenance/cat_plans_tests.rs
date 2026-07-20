//! Ported from `internal/maintenance/cat_plans_test.go`.

use std::collections::HashMap;

use chrono::{Duration, Utc};

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::scan_category;
use crate::maintenance::types::{Candidate, CategorySpec};

#[test]
fn test_scan_plans() {
    let tmp = TempDir::new("plans");
    let root = tmp.path();
    let dir = root.join("plans");
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);

    // A stale plan + its variant sibling (grouped), plus a fresh standalone plan.
    write_aged(&dir.join("feature.md"), "# plan", days_before(now_local, 120));
    write_aged(&dir.join("feature.agent.md"), "# variant", days_before(now_local, 120));
    write_aged(&dir.join("recent.md"), "# recent", days_before(now_local, 3));

    let spec = CategorySpec {
        id: "plans".to_string(),
        root: root.to_string_lossy().into_owned(),
        now,
        cutoff: Some((now_local - Duration::days(60)).with_timezone(&Utc)),
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();
    assert_eq!(cands.len(), 3, "all plans listed");

    let by_name: HashMap<String, Candidate> = cands
        .iter()
        .map(|c| (c.meta["name"].clone(), c.clone()))
        .collect();

    assert_eq!(by_name["feature.md"].group, "feature");
    assert_eq!(by_name["feature.agent.md"].group, "feature");
    assert_eq!(by_name["recent.md"].group, "", "standalone plan ungrouped");

    assert_eq!(by_name["feature.md"].meta.get("stale").map(String::as_str), Some("true"));
    assert_ne!(by_name["recent.md"].meta.get("stale").map(String::as_str), Some("true"));
}
