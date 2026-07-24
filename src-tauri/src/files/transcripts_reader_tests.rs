//! `tempfile` is not a dep → use `std::env::temp_dir()` + a unique subdir
//! (never touches real `~/.claude` files), matching `history_reader_tests.rs`.
//! Fixture lines mirror a real `ses_*.jsonl` record shape, not the struct.

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
    let dir = std::env::temp_dir().join(format!(
        "claude-transcripts-test-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(dir.join("transcripts")).unwrap();
    fs::canonicalize(&dir).unwrap()
}

fn write_transcript(root: &PathBuf, name: &str, lines: &[String]) {
    fs::write(root.join("transcripts").join(name), lines.join("\n")).unwrap();
}

#[test]
fn maps_user_tool_use_tool_result() {
    let root = make_temp_root();
    write_transcript(
        &root,
        "ses_abc.jsonl",
        &[
            r#"{"type":"user","content":"hello there","timestamp":"2026-01-16T08:04:39.613Z"}"#
                .to_string(),
            r#"{"type":"tool_use","tool_name":"Read","tool_input":{"file":"a.txt"},"timestamp":"2026-01-16T08:04:40.000Z"}"#
                .to_string(),
            r#"{"type":"tool_result","tool_name":"Read","tool_output":{"content":"file body"},"timestamp":"2026-01-16T08:04:41.000Z"}"#
                .to_string(),
        ],
    );

    let records =
        read_transcript(&root.to_string_lossy(), "ses_abc.jsonl").expect("read_transcript");
    assert_eq!(records.len(), 3);

    let user = &records[0];
    assert_eq!(user.kind, "user");
    assert_eq!(user.content.as_deref(), Some("hello there"));
    assert_eq!(user.timestamp.as_deref(), Some("2026-01-16T08:04:39.613Z"));
    assert!(!user.truncated);

    let tool_use = &records[1];
    assert_eq!(tool_use.kind, "tool_use");
    assert_eq!(tool_use.tool_name.as_deref(), Some("Read"));
    assert!(tool_use.tool_input.as_deref().unwrap().contains("a.txt"));

    let tool_result = &records[2];
    assert_eq!(tool_result.kind, "tool_result");
    assert_eq!(tool_result.tool_name.as_deref(), Some("Read"));
    assert!(tool_result
        .tool_output
        .as_deref()
        .unwrap()
        .contains("file body"));
}

#[test]
fn timestamp_stays_iso8601_string() {
    let root = make_temp_root();
    write_transcript(
        &root,
        "ses_ts.jsonl",
        &[r#"{"type":"user","content":"x","timestamp":"2026-01-16T08:04:39.613Z"}"#.to_string()],
    );
    let records =
        read_transcript(&root.to_string_lossy(), "ses_ts.jsonl").expect("read_transcript");
    // Field is `Option<String>` at compile time; assert the exact ISO-8601
    // text survives untouched (proves it was never coerced to a number).
    assert_eq!(
        records[0].timestamp,
        Some("2026-01-16T08:04:39.613Z".to_string())
    );
}

#[test]
fn truncates_oversized_field_and_sets_flag() {
    let root = make_temp_root();
    let big = "x".repeat(TRUNCATE_BYTES + 1000);
    write_transcript(
        &root,
        "ses_big.jsonl",
        &[format!(
            r#"{{"type":"user","content":"{big}","timestamp":"2026-01-16T08:04:39.613Z"}}"#
        )],
    );
    let records =
        read_transcript(&root.to_string_lossy(), "ses_big.jsonl").expect("read_transcript");
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert!(record.truncated);
    let content = record.content.as_deref().unwrap();
    assert!(content.len() < big.len());
    assert!(content.contains("…[truncated"));
}

#[test]
fn skips_malformed_line() {
    let root = make_temp_root();
    write_transcript(
        &root,
        "ses_bad.jsonl",
        &[
            r#"{"type":"user","content":"good","timestamp":"2026-01-16T08:04:39.613Z"}"#
                .to_string(),
            "not json at all".to_string(),
            r#"{"type":"user","content":"also good","timestamp":"2026-01-16T08:04:40.613Z"}"#
                .to_string(),
        ],
    );
    let records =
        read_transcript(&root.to_string_lossy(), "ses_bad.jsonl").expect("read_transcript");
    assert_eq!(records.len(), 2, "malformed line must be skipped");
}

#[test]
fn rejects_traversal_id() {
    let root = make_temp_root();
    let result = read_transcript(&root.to_string_lossy(), "../foo");
    assert!(result.is_err());
}

#[test]
fn rejects_non_ses_prefixed_id() {
    let root = make_temp_root();
    write_transcript(
        &root,
        "not_a_session.jsonl",
        &[r#"{"type":"user","content":"x","timestamp":"2026-01-16T08:04:39.613Z"}"#.to_string()],
    );
    let result = read_transcript(&root.to_string_lossy(), "not_a_session.jsonl");
    assert!(result.is_err());
}
