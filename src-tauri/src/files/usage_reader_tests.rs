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
    let dir =
        std::env::temp_dir().join(format!("usage-reader-test-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

const FULL_STATS_CACHE: &str = r#"{
    "dailyActivity": {"2026-07-01": 12},
    "dailyModelTokens": {"2026-07-01": {"claude-sonnet-5": 4096}},
    "firstSessionDate": "2025-01-01",
    "hourCounts": {"9": 3, "10": 5},
    "lastComputedDate": "2026-07-24",
    "longestSession": {"sessionId": "abc123", "durationMs": 3600000},
    "modelUsage": {"claude-sonnet-5": 42},
    "totalMessages": 999,
    "totalSessions": 17,
    "version": 3
}"#;

#[test]
fn read_usage_stats_parses_full_key_set() {
    let root = make_temp_root();
    fs::write(root.join("stats-cache.json"), FULL_STATS_CACHE).unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let value = read_usage_stats(&root_str).expect("read_usage_stats");

    let obj = value.as_object().expect("expected a JSON object");
    assert_eq!(obj.get("totalSessions").and_then(|v| v.as_i64()), Some(17));
}

#[test]
fn read_usage_stats_tolerates_missing_key() {
    let root = make_temp_root();
    let mut cache: serde_json::Value = serde_json::from_str(FULL_STATS_CACHE).unwrap();
    cache.as_object_mut().unwrap().remove("modelUsage");
    fs::write(
        root.join("stats-cache.json"),
        serde_json::to_string(&cache).unwrap(),
    )
    .unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let value = read_usage_stats(&root_str).expect("read_usage_stats");

    let obj = value.as_object().expect("expected a JSON object");
    assert!(!obj.contains_key("modelUsage"));
    assert!(obj.contains_key("totalSessions"));
}

#[test]
fn read_usage_stats_missing_file_is_null() {
    let root = make_temp_root();
    let root_str = root.to_string_lossy().into_owned();
    let value = read_usage_stats(&root_str).expect("read_usage_stats");
    assert!(value.is_null());
}
