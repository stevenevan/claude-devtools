use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;

fn temp_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock must be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("claude-devtools-codex-{nonce}"))
}

struct CodexHomeGuard {
    previous: Option<std::ffi::OsString>,
    root: PathBuf,
}

impl CodexHomeGuard {
    fn new() -> Self {
        let root = temp_root();
        fs::create_dir_all(root.join("sessions/2026/08/13")).expect("create fixture root");
        let previous = std::env::var_os("CODEX_HOME");
        std::env::set_var("CODEX_HOME", &root);
        Self { previous, root }
    }
}

impl Drop for CodexHomeGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var("CODEX_HOME", value),
            None => std::env::remove_var("CODEX_HOME"),
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn history_and_transcript_reads_are_sanitized() {
    let _lock = crate::files::TEST_ENV_LOCK.lock().unwrap();
    let guard = CodexHomeGuard::new();
    fs::write(
        guard.root.join("history.jsonl"),
        "{\"session_id\":\"s1\",\"text\":\"hello API_KEY=sk-test-value\",\"cwd\":\"/Users/test/project\",\"ts\":1723500000000}\n",
    )
    .expect("write history fixture");
    fs::write(
        guard.root.join("session_index.jsonl"),
        "{\"id\":\"s1\",\"thread_name\":\"A safe title\"}\n",
    )
    .expect("write index fixture");
    fs::write(
        guard.root.join("sessions/2026/08/13/rollout-s1.jsonl"),
        concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello API_KEY=sk-test-value\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"custom_tool_call\",\"name\":\"shell\",\"arguments\":\"SECRET_ARGUMENT\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"custom_tool_call_output\",\"name\":\"shell\",\"output\":\"SECRET_OUTPUT\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"encrypted_content\",\"data\":\"SECRET_REASONING\"}}\n",
        ),
    )
    .expect("write transcript fixture");

    let history = read_history_page(None, 20, None).expect("read history");
    assert_eq!(history.items.len(), 1);
    assert_eq!(history.items[0].project, "project");
    assert!(history.items[0].display.contains("[redacted]"));
    assert!(!history.items[0].display.contains("sk-test-value"));

    let transcripts = list_transcripts(None, 20).expect("list transcripts");
    assert_eq!(transcripts.items.len(), 1);
    let events = read_transcript(&transcripts.items[0].id, None, 20).expect("read transcript");
    let serialized = serde_json::to_string(&events).expect("serialize events");
    assert!(serialized.contains("shell"));
    assert!(serialized.contains("[redacted]"));
    assert!(!serialized.contains("sk-test-value"));
    assert!(!serialized.contains("SECRET_ARGUMENT"));
    assert!(!serialized.contains("SECRET_OUTPUT"));
    assert!(!serialized.contains("SECRET_REASONING"));
    assert!(!read_session("s1", None, 20)
        .expect("read session")
        .items
        .is_empty());
}

#[test]
fn traversal_and_stale_cursors_are_rejected() {
    let _lock = crate::files::TEST_ENV_LOCK.lock().unwrap();
    let guard = CodexHomeGuard::new();
    fs::write(
        guard.root.join("history.jsonl"),
        concat!(
            "{\"session_id\":\"s1\",\"text\":\"hello\"}\n",
            "{\"session_id\":\"s2\",\"text\":\"another\"}\n",
        ),
    )
    .expect("write history fixture");
    assert!(read_transcript("../outside.jsonl", None, 20).is_err());

    let page = read_history_page(None, 1, None).expect("read first page");
    let cursor = page.next_cursor;
    fs::OpenOptions::new()
        .append(true)
        .open(guard.root.join("history.jsonl"))
        .expect("open history fixture")
        .write_all(b"{\"session_id\":\"s2\",\"text\":\"changed\"}\n")
        .expect("append history fixture");
    if let Some(cursor) = cursor {
        assert!(read_history_page(Some(&cursor), 1, None).is_err());
    }
}

#[cfg(unix)]
#[test]
fn symlinked_rollout_outside_root_is_rejected() {
    use std::os::unix::fs::symlink;

    let _lock = crate::files::TEST_ENV_LOCK.lock().unwrap();
    let guard = CodexHomeGuard::new();
    let outside = guard.root.with_extension("outside.jsonl");
    fs::write(&outside, "{\"type\":\"event_msg\"}\n").expect("write outside fixture");
    let link = guard.root.join("sessions/2026/08/13/rollout-link.jsonl");
    symlink(&outside, &link).expect("create symlink fixture");
    let inside = guard
        .root
        .join("sessions/2026/08/13/rollout-inside-target.jsonl");
    fs::write(&inside, "{\"type\":\"session_meta\"}\n").expect("write inside fixture");
    let inside_link = guard
        .root
        .join("sessions/2026/08/13/rollout-inside-link.jsonl");
    symlink(&inside, &inside_link).expect("create inside symlink fixture");

    let listed = list_transcripts(None, 20).expect("list transcripts");
    assert!(!listed
        .items
        .iter()
        .any(|item| item.id.ends_with("rollout-link.jsonl")));
    assert!(read_transcript("sessions/2026/08/13/rollout-link.jsonl", None, 20).is_err());
    assert!(read_transcript("sessions/2026/08/13/rollout-inside-link.jsonl", None, 20).is_err());
    fs::remove_file(outside).expect("remove outside fixture");
}

#[test]
fn paginated_history_base_chain_is_bounded_and_confined() {
    let _lock = crate::files::TEST_ENV_LOCK.lock().unwrap();
    let guard = CodexHomeGuard::new();
    fs::write(
        guard.root.join("history.jsonl"),
        concat!(
            "{\"history_mode\":\"paginated\",\"history_base\":\"history-base.jsonl\"}\n",
            "{\"session_id\":\"current\",\"text\":\"current row\"}\n",
        ),
    )
    .expect("write paginated history");
    fs::write(
        guard.root.join("history-base.jsonl"),
        concat!(
            "{\"history_mode\":\"paginated\",\"history_base\":\"history.jsonl\"}\n",
            "{\"session_id\":\"base\",\"text\":\"base row\"}\n",
        ),
    )
    .expect("write cyclic history base");

    let page = read_history_page(None, 20, None).expect("read paginated history");
    assert_eq!(page.items.len(), 2);
    assert!(page
        .diagnostics
        .iter()
        .any(|item| item.code == "historyBaseCycle"));

    fs::write(
        guard.root.join("history.jsonl"),
        "{\"history_mode\":\"paginated\",\"history_base\":\"../outside.jsonl\"}\n",
    )
    .expect("write escaping history base");
    let page = read_history_page(None, 20, None).expect("read confined history");
    assert!(page
        .diagnostics
        .iter()
        .any(|item| item.code == "historyBaseOutsideRoot"));
}

#[test]
fn session_summary_and_byte_cursor_preserve_bounded_events() {
    let _lock = crate::files::TEST_ENV_LOCK.lock().unwrap();
    let guard = CodexHomeGuard::new();
    fs::write(
        guard.root.join("sessions/2026/08/13/rollout-s1.jsonl"),
        concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"type\":\"session_meta\",\"id\":\"s1\",\"cwd\":\"/synthetic/project\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"first\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":\"answer\"}}\n",
            "{\"type\":\"future_event\",\"payload\":{\"type\":\"future_event\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"second\"}}\n",
        ),
    )
    .expect("write session fixture");

    let first = read_session("s1", None, 2).expect("read first session page");
    let summary = first.session.as_ref().expect("session summary");
    assert_eq!(summary.session_id, "s1");
    assert_eq!(summary.project, "project");
    assert_eq!(summary.turn_count, 1);
    assert_eq!(summary.event_count, Some(5));
    assert!(first.has_more);
    assert!(first
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "unknownEvent"));

    let second =
        read_session("s1", first.next_cursor.as_deref(), 3).expect("read second session page");
    assert_eq!(second.items.len(), 3);
    assert!(!second.has_more);
    assert_eq!(second.session.expect("continued session summary").turn_count, 2);
    assert!(second.items.iter().any(|event| event.kind == "unknown"));
}

#[test]
fn malformed_history_is_reported_without_hiding_valid_rows() {
    let _lock = crate::files::TEST_ENV_LOCK.lock().unwrap();
    let guard = CodexHomeGuard::new();
    fs::write(
        guard.root.join("history.jsonl"),
        concat!("not json\n", "{\"session_id\":\"s1\",\"text\":\"valid\"}\n",),
    )
    .expect("write malformed history");
    let page = read_history_page(None, 20, None).expect("read malformed history");
    assert_eq!(page.items.len(), 1);
    assert!(page
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "invalidJson"));
}

#[test]
fn task_graphs_keep_valid_nodes_and_report_edges_and_incompatible_files() {
    let _lock = crate::files::TEST_ENV_LOCK.lock().unwrap();
    let guard = CodexHomeGuard::new();
    let good = guard.root.join("tasks/good");
    let bad = guard.root.join("tasks/bad");
    fs::create_dir_all(&good).expect("create good graph");
    fs::create_dir_all(&bad).expect("create bad graph");
    fs::write(
        good.join("1.json"),
        r#"{"id":"1","subject":"first","description":"API_KEY=sk-task-value","activeForm":"Doing first","status":"pending","blocks":["missing"],"blockedBy":[]}"#,
    )
    .expect("write good graph");
    fs::write(good.join("2.json"), "not json").expect("write malformed node");
    fs::write(bad.join("1.json"), r#"{"wrong":true}"#).expect("write incompatible graph");

    let list = list_task_graphs().expect("list task graphs");
    assert_eq!(list.items.len(), 2);
    assert_eq!(
        list.capability.state,
        crate::types::source::TaskGraphCapabilityState::Available
    );
    assert!(list
        .capability
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "missingTaskReference"));

    let result = read_task_graph("good").expect("read good graph");
    assert_eq!(result.nodes.len(), 1);
    assert_eq!(result.nodes[0].description, "API_KEY=[redacted]");
    assert!(!serde_json::to_string(&result)
        .expect("serialize task graph")
        .contains("sk-task-value"));
    assert!(result
        .capability
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "missingTaskReference"));
    let incompatible = read_task_graph("bad").expect("read incompatible graph");
    assert_eq!(
        incompatible.capability.state,
        crate::types::source::TaskGraphCapabilityState::UnsupportedCapability
    );
}
