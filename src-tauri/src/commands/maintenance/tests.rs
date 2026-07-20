//! Ports the pure service-layer tests from `scheduler_test.go`
//! (`TestIsScheduleDue` / `TestPartitionScheduledPolicy`). The
//! `runScheduledClean` filesystem tests are out of scope here (they exercise the
//! already-green `maintenance::*` domain + an AppHandle emit path).

use std::collections::BTreeMap;

use chrono::{Duration, TimeZone, Utc};

use super::scheduler::{is_schedule_due, partition_scheduled_policy};
use crate::config::state::types::{RetentionCategory, RetentionPolicy};

#[test]
fn is_schedule_due_matches_go() {
    let now = Utc.with_ymd_and_hms(2026, 7, 15, 12, 0, 0).unwrap();
    let ms = |d: Duration| (now - d).timestamp_millis() as f64;

    let cases = [
        ("off never fires", "off", ms(Duration::days(365)), false),
        ("unknown interval never fires", "hourly", ms(Duration::days(365)), false),
        ("weekly never-run is due", "weekly", 0.0, true),
        ("weekly 8d ago is due", "weekly", ms(Duration::days(8)), true),
        ("weekly 3d ago not due", "weekly", ms(Duration::days(3)), false),
        ("monthly 40d ago is due", "monthly", ms(Duration::days(40)), true),
        ("monthly 10d ago not due", "monthly", ms(Duration::days(10)), false),
    ];
    for (name, interval, last, want) in cases {
        assert_eq!(is_schedule_due(interval, last, now), want, "{name}");
    }
}

#[test]
fn partition_scheduled_policy_matches_go() {
    let mut categories = BTreeMap::new();
    categories.insert("plans".to_string(), RetentionCategory { enabled: true, auto_approved: true });
    categories.insert("transcripts".to_string(), RetentionCategory { enabled: true, auto_approved: false });
    categories.insert("plugins".to_string(), RetentionCategory { enabled: false, auto_approved: true });
    categories.insert("logs".to_string(), RetentionCategory { enabled: true, auto_approved: true });
    let policy = RetentionPolicy {
        categories,
        trash_expiry_days: 30,
        schedule_interval: "off".to_string(),
    };

    let (auto, pending) = partition_scheduled_policy(&policy);

    assert!(auto.categories["plans"].enabled, "auto-approved plans must be enabled");
    assert!(!auto.categories["transcripts"].enabled, "non-auto transcripts must be disabled");
    assert!(!auto.categories["logs"].enabled, "plain-delete logs must never be enabled");
    assert_eq!(pending, vec!["transcripts".to_string()], "pending must be exactly [transcripts]");
}
