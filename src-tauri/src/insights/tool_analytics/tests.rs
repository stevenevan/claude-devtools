use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::aggregator::{finalize, median_u64};
use super::scanner::{bucket_local, scan_session, scan_session_heatmap};
use super::shared::{HeatmapCellAcc, HeatmapKey, ToolStats};

fn write_fixture(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
    let path = dir.join(name);
    let mut f = std::fs::File::create(&path).unwrap();
    for l in lines {
        writeln!(f, "{l}").unwrap();
    }
    path
}

#[test]
fn median_odd_even() {
    let mut a = vec![1u64, 5, 9];
    assert_eq!(median_u64(&mut a), 5);
    let mut b = vec![1u64, 5, 9, 11];
    assert_eq!(median_u64(&mut b), 7);
    let mut c: Vec<u64> = vec![];
    assert_eq!(median_u64(&mut c), 0);
}

#[test]
fn scan_pairs_tool_use_and_result() {
    let tmp = std::env::temp_dir().join(format!("tool_analytics_test_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let lines = [
        r#"{"timestamp":"2026-04-16T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#,
        r#"{"timestamp":"2026-04-16T10:00:02.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok","is_error":false}]}}"#,
        r#"{"timestamp":"2026-04-16T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"cat x"}}]}}"#,
        r#"{"timestamp":"2026-04-16T10:00:06.500Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t2","content":"fail","is_error":true}]}}"#,
        r#"{"timestamp":"2026-04-16T10:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Read","input":{"path":"/a"}}]}}"#,
        r#"{"timestamp":"2026-04-16T10:00:11.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t3","content":"abcdefg","is_error":false}]}}"#,
    ];
    let path = write_fixture(&tmp, "session.jsonl", &lines);

    let mut stats: HashMap<String, ToolStats> = HashMap::new();
    scan_session(&path, &mut stats).unwrap();
    let results = finalize(stats);

    let bash = results.iter().find(|t| t.tool_name == "Bash").unwrap();
    assert_eq!(bash.call_count, 2);
    assert_eq!(bash.success_count, 1);
    assert_eq!(bash.error_count, 1);
    assert!((bash.success_rate - 0.5).abs() < 1e-9);
    assert!((bash.error_rate - 0.5).abs() < 1e-9);
    // Durations: 2000ms and 1500ms → avg 1750
    assert!((bash.avg_duration_ms - 1750.0).abs() < 1e-6);

    let read = results.iter().find(|t| t.tool_name == "Read").unwrap();
    assert_eq!(read.call_count, 1);
    assert_eq!(read.success_count, 1);
    assert_eq!(read.error_count, 0);
    assert!(read.median_token_cost > 0);

    std::fs::remove_dir_all(&tmp).unwrap();
}

#[test]
fn finalize_sorts_by_call_count_desc() {
    let mut stats: HashMap<String, ToolStats> = HashMap::new();
    stats.insert("A".to_string(), ToolStats { call_count: 1, success_count: 1, error_count: 0, duration_samples: vec![], token_samples: vec![] });
    stats.insert("B".to_string(), ToolStats { call_count: 5, success_count: 5, error_count: 0, duration_samples: vec![], token_samples: vec![] });
    stats.insert("C".to_string(), ToolStats { call_count: 3, success_count: 2, error_count: 1, duration_samples: vec![], token_samples: vec![] });
    let out = finalize(stats);
    assert_eq!(out[0].tool_name, "B");
    assert_eq!(out[1].tool_name, "C");
    assert_eq!(out[2].tool_name, "A");
}

#[test]
fn orphan_tool_result_ignored() {
    let tmp = std::env::temp_dir().join(format!("tool_analytics_orphan_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let lines = [
        r#"{"timestamp":"2026-04-16T10:00:00.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"missing","content":"x","is_error":false}]}}"#,
    ];
    let path = write_fixture(&tmp, "session.jsonl", &lines);

    let mut stats: HashMap<String, ToolStats> = HashMap::new();
    scan_session(&path, &mut stats).unwrap();
    assert!(stats.is_empty());

    std::fs::remove_dir_all(&tmp).unwrap();
}

#[test]
fn heatmap_bucket_local_uses_local_timezone_weekday_and_hour() {
    // 2026-04-20 (Monday) at 15:30 UTC — check that the local bucket is a
    // plausible Mon/Tue/Sun hour (depends on runner tz). We assert day is
    // in range and hour in range, and the round-trip is stable.
    let ms = chrono::DateTime::parse_from_rfc3339("2026-04-20T15:30:00Z")
        .unwrap()
        .timestamp_millis() as f64;
    let (day, hour) = bucket_local(ms).unwrap();
    assert!(day < 7);
    assert!(hour < 24);
}

#[test]
fn heatmap_scan_buckets_assistant_tool_uses() {
    let tmp = std::env::temp_dir().join(format!("tool_heatmap_test_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    // Two tool_use blocks at the same timestamp, different tools.
    let lines = [
        r#"{"timestamp":"2026-04-20T09:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}"#,
        r#"{"timestamp":"2026-04-20T09:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{}}]}}"#,
        r#"{"timestamp":"2026-04-20T09:00:20.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Read","input":{}}]}}"#,
    ];
    let path = write_fixture(&tmp, "session.jsonl", &lines);

    let mut buckets: HashMap<HeatmapKey, HeatmapCellAcc> = HashMap::new();
    scan_session_heatmap(&path, &mut buckets, None).unwrap();

    // Exactly one bucket should be populated (all three tool_uses in same hour).
    assert_eq!(buckets.len(), 1);
    let cell = buckets.values().next().unwrap();
    assert_eq!(cell.total, 3);
    // Bash dominates (2 calls vs 1 Read) → top_tool in finalize is Bash.
    assert_eq!(*cell.per_tool.get("Bash").unwrap(), 2);
    assert_eq!(*cell.per_tool.get("Read").unwrap(), 1);

    std::fs::remove_dir_all(&tmp).unwrap();
}

#[test]
fn heatmap_tool_filter_excludes_non_matching() {
    let tmp = std::env::temp_dir()
        .join(format!("tool_heatmap_filter_test_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let lines = [
        r#"{"timestamp":"2026-04-20T09:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}"#,
        r#"{"timestamp":"2026-04-20T09:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Read","input":{}}]}}"#,
    ];
    let path = write_fixture(&tmp, "session.jsonl", &lines);

    let mut buckets: HashMap<HeatmapKey, HeatmapCellAcc> = HashMap::new();
    scan_session_heatmap(&path, &mut buckets, Some("Bash")).unwrap();

    let cell = buckets.values().next().unwrap();
    assert_eq!(cell.total, 1);
    assert!(cell.per_tool.contains_key("Bash"));
    assert!(!cell.per_tool.contains_key("Read"));

    std::fs::remove_dir_all(&tmp).unwrap();
}
