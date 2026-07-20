use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::event::{
    AccessKind, CreateKind, DataChange, EventKind, MetadataKind, ModifyKind, RemoveKind, RenameMode,
};
use serde::Deserialize;
use serde_json::{json, Value};

use super::parsers::{map_event_kind, parse_project_file, parse_todo_file, resolve_claude_dir};
use super::{schedule, Runner, DEBOUNCE_MS};

// ---------------------------------------------------------------------------
// map_event_kind — mirrors watcher_test.go TestMapEventKind (notify v7 arms)
// ---------------------------------------------------------------------------

#[test]
fn map_event_kind_reproduces_go_outcomes() {
    // Go Create → "add"
    assert_eq!(map_event_kind(&EventKind::Create(CreateKind::File)), Some("add"));
    // Go Write → "change" (notify v7 content write = Modify(Data))
    assert_eq!(
        map_event_kind(&EventKind::Modify(ModifyKind::Data(DataChange::Content))),
        Some("change")
    );
    // FSEvents coalesced write arrives as Modify(Any) → "change"
    assert_eq!(map_event_kind(&EventKind::Modify(ModifyKind::Any)), Some("change"));
    // Go Remove → "unlink"
    assert_eq!(map_event_kind(&EventKind::Remove(RemoveKind::File)), Some("unlink"));
    // Go Rename → "unlink" (notify v7 rename = Modify(Name))
    assert_eq!(
        map_event_kind(&EventKind::Modify(ModifyKind::Name(RenameMode::Any))),
        Some("unlink")
    );
    // Go default → none: access, chmod (Metadata), Other
    assert_eq!(map_event_kind(&EventKind::Access(AccessKind::Any)), None);
    assert_eq!(
        map_event_kind(&EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any))),
        None
    );
    assert_eq!(map_event_kind(&EventKind::Other), None);
}

// ---------------------------------------------------------------------------
// parse_project_file — mirrors watcher_test.go TestParseProjectFile (7 cases)
// ---------------------------------------------------------------------------

const PROJECTS: &str = "/home/user/.claude/projects";

#[test]
fn parse_project_file_session() {
    let evt = parse_project_file(
        Path::new(PROJECTS),
        Path::new("/home/user/.claude/projects/-Users-name-project/abc123.jsonl"),
        "change",
    )
    .unwrap();
    assert_eq!(evt.project_id.as_deref(), Some("-Users-name-project"));
    assert_eq!(evt.session_id.as_deref(), Some("abc123"));
    assert!(!evt.is_subagent);
    assert_eq!(evt.change_type, "change");
}

#[test]
fn parse_project_file_subagent() {
    let evt = parse_project_file(
        Path::new(PROJECTS),
        Path::new(
            "/home/user/.claude/projects/-Users-name-project/abc123/subagents/agent-def456.jsonl",
        ),
        "add",
    )
    .unwrap();
    assert_eq!(evt.project_id.as_deref(), Some("-Users-name-project"));
    assert_eq!(evt.session_id.as_deref(), Some("abc123"));
    assert!(evt.is_subagent);
    assert_eq!(evt.change_type, "add");
}

#[test]
fn parse_project_file_ignores_non_jsonl() {
    assert!(parse_project_file(
        Path::new(PROJECTS),
        Path::new("/home/user/.claude/projects/-Users-name-project/README.md"),
        "change",
    )
    .is_none());
}

#[test]
fn parse_project_file_ignores_wrong_depth() {
    // Project dir itself, no file (1 component).
    assert!(parse_project_file(
        Path::new(PROJECTS),
        Path::new("/home/user/.claude/projects/-Users-name-project"),
        "change",
    )
    .is_none());
}

#[test]
fn parse_project_file_ignores_3_components() {
    assert!(parse_project_file(
        Path::new(PROJECTS),
        Path::new("/home/user/.claude/projects/-Users-name-project/abc123/random.jsonl"),
        "change",
    )
    .is_none());
}

#[test]
fn parse_project_file_preserves_absolute_path() {
    let file = "/home/user/.claude/projects/-Users-name-project/session1.jsonl";
    let evt = parse_project_file(Path::new(PROJECTS), Path::new(file), "add").unwrap();
    assert_eq!(evt.path, file);
}

#[test]
fn parse_project_file_all_change_types() {
    let file = "/home/user/.claude/projects/-Users-name-project/s1.jsonl";
    for ct in ["add", "change", "unlink"] {
        let evt = parse_project_file(Path::new(PROJECTS), Path::new(file), ct).unwrap();
        assert_eq!(evt.change_type, ct);
    }
}

// ---------------------------------------------------------------------------
// parse_todo_file — mirrors watcher_test.go TestParseTodoFile (4 cases)
// ---------------------------------------------------------------------------

const TODOS: &str = "/home/user/.claude/todos";

#[test]
fn parse_todo_file_basic() {
    let evt = parse_todo_file(
        Path::new(TODOS),
        Path::new("/home/user/.claude/todos/abc123.json"),
        "change",
    )
    .unwrap();
    assert_eq!(evt.session_id.as_deref(), Some("abc123"));
    assert!(evt.project_id.is_none());
    assert!(!evt.is_subagent);
    assert_eq!(evt.change_type, "change");
}

#[test]
fn parse_todo_file_ignores_non_json() {
    assert!(parse_todo_file(
        Path::new(TODOS),
        Path::new("/home/user/.claude/todos/abc123.txt"),
        "change",
    )
    .is_none());
}

#[test]
fn parse_todo_file_unlink() {
    let evt = parse_todo_file(
        Path::new(TODOS),
        Path::new("/home/user/.claude/todos/session-uuid.json"),
        "unlink",
    )
    .unwrap();
    assert_eq!(evt.session_id.as_deref(), Some("session-uuid"));
    assert_eq!(evt.change_type, "unlink");
}

#[test]
fn parse_todo_file_uuid_session_id() {
    let want = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    let evt = parse_todo_file(
        Path::new(TODOS),
        Path::new(&format!("/home/user/.claude/todos/{want}.json")),
        "change",
    )
    .unwrap();
    assert_eq!(evt.session_id.as_deref(), Some(want));
}

// ---------------------------------------------------------------------------
// resolve_claude_dir — mirrors watcher_test.go TestResolveClaudeDir
// ---------------------------------------------------------------------------

#[test]
fn resolve_claude_dir_returns_some() {
    assert!(resolve_claude_dir().is_some());
}

// ---------------------------------------------------------------------------
// Parser golden — committed event-shape fixture.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GoldenEntry {
    kind: String,
    dir: String,
    path: String,
    #[serde(rename = "changeType")]
    change_type: String,
    event: Option<Value>,
}

#[test]
fn parsers_match_go_golden() {
    let path =
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/parity/watcher_events.golden.json");
    let raw = fs::read_to_string(path).unwrap_or_else(|_| {
        panic!(
            "committed watcher fixture not found at {path}"
        )
    });
    let entries: Vec<GoldenEntry> = serde_json::from_str(&raw).expect("parse golden json");

    for entry in entries {
        let got = match entry.kind.as_str() {
            "project" => parse_project_file(
                Path::new(&entry.dir),
                Path::new(&entry.path),
                &entry.change_type,
            ),
            "todo" => {
                parse_todo_file(Path::new(&entry.dir), Path::new(&entry.path), &entry.change_type)
            }
            other => panic!("unknown golden kind: {other}"),
        };
        let got_value = match got {
            Some(evt) => serde_json::to_value(&evt).unwrap(),
            None => Value::Null,
        };
        let want_value = entry.event.unwrap_or(Value::Null);
        assert_eq!(
            got_value, want_value,
            "golden mismatch for {} {}",
            entry.kind, entry.path
        );
    }
}

// ---------------------------------------------------------------------------
// Deterministic debounce + routing. `notify` FSEvents cannot start under the
// sandboxed test runner, so inject events after notify's map_event_kind boundary.
// This still exercises Runner's production scheduler and event routing.
// ---------------------------------------------------------------------------

fn make_temp_dir() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("watcher-test-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    // Canonicalize so watched paths match the /private/... paths FSEvents reports
    // (macOS /var/folders → /private/var/folders); mirrors Go's EvalSymlinks.
    fs::canonicalize(&dir).unwrap()
}

fn wait_for_event<F>(matches: F)
where
    F: Fn() -> bool,
{
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !matches() {
        assert!(std::time::Instant::now() < deadline, "timed out waiting for watcher event");
        thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn debounce_window_matches_go() {
    assert_eq!(DEBOUNCE_MS, 100);
}

#[test]
fn integration_debounced_file_change() {
    let real_tmp = make_temp_dir();
    let projects_dir = real_tmp.join("projects");
    let project_sub = projects_dir.join("-test-project");
    let todos_dir = real_tmp.join("todos");
    fs::create_dir_all(&project_sub).unwrap();
    fs::create_dir_all(&todos_dir).unwrap();

    let events: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let runner = Runner::new(
        projects_dir.to_str().unwrap(),
        todos_dir.to_str().unwrap(),
        "",
        "",
        move |name: &str, payload: Value| {
            sink.lock().unwrap().push((name.to_string(), payload));
        },
    );

    // Schedule the same path 5× within the debounce window.
    let file = project_sub.join("session1.jsonl");
    for _ in 0..5 {
        schedule(&runner.ctx, file.clone(), "change");
        thread::sleep(Duration::from_millis(10));
    }

    wait_for_event(|| {
        events
            .lock()
            .unwrap()
            .iter()
            .any(|(name, _)| name == "file-change")
    });

    let recorded = events.lock().unwrap();
    let file_changes: Vec<&Value> = recorded
        .iter()
        .filter(|(name, _)| name == "file-change")
        .map(|(_, payload)| payload)
        .collect();
    let _ = fs::remove_dir_all(&real_tmp);

    assert_eq!(
        file_changes.len(),
        1,
        "expected exactly one debounced file-change, got {}: {:?}",
        file_changes.len(),
        *recorded
    );
    let payload = file_changes[0];
    assert_eq!(payload["projectId"], json!("-test-project"));
    assert_eq!(payload["sessionId"], json!("session1"));
    assert_eq!(payload["isSubagent"], json!(false));
}

#[test]
fn integration_config_file_change() {
    let real_tmp = make_temp_dir();
    let config_dir = real_tmp.clone();
    let projects_dir = real_tmp.join("projects");
    let todos_dir = real_tmp.join("todos");
    fs::create_dir_all(&projects_dir).unwrap();
    fs::create_dir_all(&todos_dir).unwrap();

    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let runner = Runner::new(
        projects_dir.to_str().unwrap(),
        todos_dir.to_str().unwrap(),
        config_dir.to_str().unwrap(),
        "",
        move |name: &str, _payload: Value| {
            sink.lock().unwrap().push(name.to_string());
        },
    );

    // Route the final atomic-write destination through the same scheduler.
    let settings = config_dir.join("settings.json");
    schedule(&runner.ctx, settings, "change");

    wait_for_event(|| {
        events
            .lock()
            .unwrap()
            .iter()
            .any(|name| name == "config-file-change")
    });

    let recorded = events.lock().unwrap();
    let saw_config = recorded.iter().any(|name| name == "config-file-change");
    let _ = fs::remove_dir_all(&real_tmp);
    assert!(saw_config, "expected a config-file-change event, got {:?}", *recorded);
}
