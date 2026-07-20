//! Ported from `internal/maintenance/cat_transcripts_test.go`.

use std::collections::HashMap;
use std::path::Path;

use chrono::{Duration, Local, TimeZone, Utc};

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::scan_category;
use crate::maintenance::types::CategorySpec;

#[test]
fn test_scan_transcripts() {
    let tmp = TempDir::new("transcripts");
    let root = tmp.path();
    let dir = root.join("transcripts");
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);

    // old (Mar) → candidate; older (Feb) → candidate; fresh → excluded.
    write_aged(
        &dir.join("ses_a.jsonl"),
        "aaaa",
        Local.with_ymd_and_hms(2026, 3, 2, 0, 0, 0).unwrap(),
    );
    write_aged(
        &dir.join("ses_b.jsonl"),
        "bb",
        Local.with_ymd_and_hms(2026, 2, 5, 0, 0, 0).unwrap(),
    );
    write_aged(&dir.join("ses_fresh.jsonl"), "c", days_before(now_local, 2));

    let spec = CategorySpec {
        id: "transcripts".to_string(),
        root: root.to_string_lossy().into_owned(),
        now,
        cutoff: Some((now_local - Duration::days(90)).with_timezone(&Utc)),
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();
    assert_eq!(cands.len(), 2, "2 stale candidates");

    let groups: HashMap<String, String> = cands
        .iter()
        .map(|c| {
            let base = Path::new(&c.path).file_name().unwrap().to_string_lossy().into_owned();
            (base, c.group.clone())
        })
        .collect();
    assert_eq!(groups["ses_a.jsonl"], "2026-03");
    assert_eq!(groups["ses_b.jsonl"], "2026-02");
}
