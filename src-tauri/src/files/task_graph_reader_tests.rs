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
    let dir = std::env::temp_dir().join(format!(
        "claude-taskgraph-test-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

fn node_json(id: &str, subject: &str, blocks: &str, blocked_by: &str) -> String {
    format!(
        r#"{{"id":"{id}","subject":"{subject}","description":"desc","activeForm":"Doing {subject}","status":"pending","blocks":{blocks},"blockedBy":{blocked_by}}}"#
    )
}

#[test]
fn list_task_graphs_skips_marker_only_dir() {
    let root = make_temp_root();
    let dir = root.join("tasks").join("live-uuid");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(".highwatermark"), "3").unwrap();
    fs::write(dir.join(".lock"), "").unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let graphs = list_task_graphs(&root_str).expect("list_task_graphs");
    assert!(
        graphs.is_empty(),
        "marker-only dir must be skipped, got {graphs:?}"
    );
}

#[test]
fn list_task_graphs_counts_populated_dir() {
    let root = make_temp_root();
    let dir = root.join("tasks").join("populated-uuid");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("1.json"), node_json("1", "first", "[]", "[]")).unwrap();
    fs::write(dir.join("2.json"), node_json("2", "second", "[]", "[]")).unwrap();
    fs::write(dir.join(".lock"), "").unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let graphs = list_task_graphs(&root_str).expect("list_task_graphs");
    assert_eq!(graphs.len(), 1);
    assert_eq!(graphs[0].uuid, "populated-uuid");
    assert_eq!(graphs[0].task_count, 2);
    assert_eq!(graphs[0].label.as_deref(), Some("first"));
    assert!(graphs[0].latest_mtime > 0, "latest_mtime must be positive");
}

#[test]
fn list_task_graphs_uses_lowest_leaf_description_when_subject_is_empty() {
    let root = make_temp_root();
    let dir = root.join("tasks").join("description-uuid");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("2.json"),
        r#"{"id":"2","subject":"later subject","description":"later description"}"#,
    )
    .unwrap();
    fs::write(
        dir.join("1.json"),
        r#"{"id":"1","subject":"  ","description":"  first description  "}"#,
    )
    .unwrap();

    let graphs = list_task_graphs(&root.to_string_lossy()).expect("list_task_graphs");
    assert_eq!(graphs[0].label.as_deref(), Some("first description"));
}

#[test]
fn list_task_graphs_falls_back_when_lowest_leaf_is_malformed_or_unlabelled() {
    let root = make_temp_root();
    let malformed_dir = root.join("tasks").join("malformed-uuid");
    fs::create_dir_all(&malformed_dir).unwrap();
    fs::write(malformed_dir.join("1.json"), "not json").unwrap();

    let empty_label_dir = root.join("tasks").join("empty-label-uuid");
    fs::create_dir_all(&empty_label_dir).unwrap();
    fs::write(
        empty_label_dir.join("1.json"),
        r#"{"id":"1","subject":" ","description":" "}"#,
    )
    .unwrap();

    let graphs = list_task_graphs(&root.to_string_lossy()).expect("list_task_graphs");
    let malformed = graphs
        .iter()
        .find(|graph| graph.uuid == "malformed-uuid")
        .expect("malformed graph");
    let empty_label = graphs
        .iter()
        .find(|graph| graph.uuid == "empty-label-uuid")
        .expect("empty-label graph");
    assert_eq!(malformed.label, None);
    assert_eq!(empty_label.label, None);
}

#[test]
fn list_task_graphs_missing_dir_is_empty() {
    let root = make_temp_root();
    let root_str = root.to_string_lossy().into_owned();
    let graphs = list_task_graphs(&root_str).expect("list_task_graphs");
    assert!(graphs.is_empty());
}

#[test]
fn read_task_graph_orders_and_maps_camel_case() {
    let root = make_temp_root();
    let dir = root.join("tasks").join("uuid-1");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("2.json"),
        node_json("2", "second", "[]", r#"["1"]"#),
    )
    .unwrap();
    fs::write(
        dir.join("1.json"),
        node_json("1", "first", r#"["2"]"#, "[]"),
    )
    .unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let nodes = read_task_graph(&root_str, "uuid-1").expect("read_task_graph");
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].id, "1", "must be ordered by N ascending");
    assert_eq!(nodes[0].subject, "first");
    assert_eq!(nodes[0].active_form, "Doing first");
    assert_eq!(nodes[0].blocks, vec!["2".to_string()]);
    assert_eq!(nodes[1].id, "2");
    assert_eq!(nodes[1].blocked_by, vec!["1".to_string()]);
}

#[test]
fn read_task_graph_skips_malformed_leaf_keeps_siblings() {
    let root = make_temp_root();
    let dir = root.join("tasks").join("uuid-2");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("1.json"), node_json("1", "good", "[]", "[]")).unwrap();
    fs::write(dir.join("2.json"), "not valid json{{{").unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let nodes = read_task_graph(&root_str, "uuid-2").expect("read_task_graph");
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].id, "1");
}

#[test]
fn read_task_graph_partial_leaf_uses_defaults() {
    let root = make_temp_root();
    let dir = root.join("tasks").join("uuid-3");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("1.json"), r#"{"id":"1","subject":"partial"}"#).unwrap();

    let root_str = root.to_string_lossy().into_owned();
    let nodes = read_task_graph(&root_str, "uuid-3").expect("read_task_graph");
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].id, "1");
    assert_eq!(nodes[0].subject, "partial");
    assert_eq!(
        nodes[0].status, "",
        "missing field defaults to empty string"
    );
    assert!(nodes[0].blocks.is_empty());
}

#[test]
fn read_task_graph_missing_dir_is_empty() {
    let root = make_temp_root();
    let root_str = root.to_string_lossy().into_owned();
    let nodes = read_task_graph(&root_str, "no-such-uuid").expect("read_task_graph");
    assert!(nodes.is_empty());
}

#[test]
fn read_task_graph_rejects_traversal_uuid() {
    let root = make_temp_root();
    fs::create_dir_all(root.join("tasks")).unwrap();
    let root_str = root.to_string_lossy().into_owned();

    assert!(read_task_graph(&root_str, "../foo").is_err());
    assert!(read_task_graph(&root_str, "a/b").is_err());
}
