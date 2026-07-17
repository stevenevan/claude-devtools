//! Ports `internal/maintenance/history_test.go`. Uses canonicalized temp dirs +
//! a fake trash closure (never real `~/.claude`, never the real trash engine).

use super::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{TimeZone, Utc};

fn make_temp_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "maint-hist-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn hist_line(ms: i64, text: &str) -> String {
    format!(r#"{{"display":{text:?},"timestamp":{ms},"project":"/p"}}"#)
}

fn write_history(root: &Path, lines: &[String]) -> String {
    let path = root.join("history.jsonl");
    write_file(&path, &(lines.join("\n") + "\n"));
    path.to_string_lossy().into_owned()
}

fn ms(year: i32, month: u32, day: u32) -> i64 {
    Utc.with_ymd_and_hms(year, month, day, 0, 0, 0)
        .unwrap()
        .timestamp_millis()
}

/// Fake trash closure — returns the paths it was handed as the "receipt" so a
/// test can assert exactly one tail file was trashed.
fn fake_trash(paths: &[String]) -> Result<Vec<String>, String> {
    Ok(paths.to_vec())
}

#[test]
fn test_analyze_history() {
    let root = make_temp_dir("analyze");
    let mar = ms(2026, 3, 1);
    let jul = ms(2026, 7, 1);
    write_history(
        &root,
        &[
            hist_line(mar, "old1"),
            hist_line(mar, "old2"),
            hist_line(jul, "recent"),
            r#"{"display":"corrupt-no-timestamp"}"#.to_string(), // malformed → counted, never fatal
        ],
    );

    let cutoff = Utc.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).unwrap();
    let stats = analyze_history(&root.to_string_lossy(), cutoff).unwrap();

    assert_eq!(stats.total_lines, 4, "total_lines");
    assert_eq!(stats.malformed, 1, "malformed");
    assert_eq!(
        stats.prunable_lines, 2,
        "the two March lines predate the May cutoff"
    );
    assert_eq!(
        stats.months.as_ref().map(Vec::len),
        Some(2),
        "want 2 month buckets"
    );
}

#[test]
fn test_prune_history_round_trip() {
    let root = make_temp_dir("prune-rt");
    let app_data = root.join(".appdata");
    let app_data_str = app_data.to_string_lossy().into_owned();
    let mar = ms(2026, 3, 1);
    let jul = ms(2026, 7, 1);
    let path = write_history(
        &root,
        &[
            hist_line(mar, "old1"),
            hist_line(jul, "keep1"),
            r#"{"display":"no-timestamp-keep-me"}"#.to_string(), // unparseable → RETAINED (H2)
            hist_line(mar, "old2"),
        ],
    );

    let cutoff = Utc.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).unwrap();
    let receipt = prune_history(&app_data_str, &path, cutoff, fake_trash).unwrap();
    assert_eq!(receipt.len(), 1, "want 1 trashed tail file");

    let head_data = fs::read_to_string(&path).unwrap();
    let head: Vec<&str> = head_data.trim_end_matches('\n').split('\n').collect();
    assert_eq!(head.len(), 2, "want 2 retained lines, got {head:?}");
    assert!(
        head_data.contains("keep1") && head_data.contains("no-timestamp-keep-me"),
        "head must retain recent + unparseable lines: {head_data}"
    );
    assert!(
        !head_data.contains("old1"),
        "March line must be pruned from head"
    );
}

#[test]
fn test_prune_history_append_conflict() {
    let root = make_temp_dir("prune-append");
    let app_data = root.join(".appdata");
    let app_data_str = app_data.to_string_lossy().into_owned();
    let mar = ms(2026, 3, 1);
    let path = write_history(&root, &[hist_line(mar, "old1"), hist_line(mar, "old2")]);

    // Simulate a CLI append (a fresh, recent line) BEFORE the prune.
    let fresh = Utc::now().timestamp_millis();
    let mut f = fs::OpenOptions::new().append(true).open(&path).unwrap();
    use std::io::Write as _;
    writeln!(f, "{}", hist_line(fresh, "fresh-appended")).unwrap();
    drop(f);

    let cutoff = Utc.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).unwrap();
    prune_history(&app_data_str, &path, cutoff, fake_trash).unwrap();

    let data = fs::read_to_string(&path).unwrap();
    assert!(
        data.contains("fresh-appended"),
        "freshly-appended line must never be lost by a prune"
    );
}

#[test]
fn test_prune_history_symlink_refused() {
    let root = make_temp_dir("prune-symlink");
    let real = root.join("real.jsonl");
    write_file(&real, &(hist_line(1, "x") + "\n"));
    let link = root.join("history.jsonl");
    if std::os::unix::fs::symlink(&real, &link).is_err() {
        return; // symlink unsupported — skip
    }
    let err = analyze_history(&root.to_string_lossy(), Utc::now());
    assert!(err.is_err(), "analyze must refuse a symlinked history.jsonl");
}
