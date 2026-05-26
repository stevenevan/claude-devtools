use std::path::Path;

use notify::event::EventKind;

use super::lifecycle::resolve_claude_dir;
use super::parsers::{map_event_kind, parse_project_file, parse_todo_file};

#[test]
fn test_parse_project_file_session() {
    let projects = Path::new("/home/user/.claude/projects");
    let file = Path::new("/home/user/.claude/projects/-Users-name-project/abc123.jsonl");
    let event = parse_project_file(projects, file, "change").unwrap();
    assert_eq!(event.project_id, Some("-Users-name-project".to_string()));
    assert_eq!(event.session_id, Some("abc123".to_string()));
    assert!(!event.is_subagent);
    assert_eq!(event.change_type, "change");
}

#[test]
fn test_parse_project_file_subagent() {
    let projects = Path::new("/home/user/.claude/projects");
    let file = Path::new(
        "/home/user/.claude/projects/-Users-name-project/abc123/subagents/agent-def456.jsonl",
    );
    let event = parse_project_file(projects, file, "add").unwrap();
    assert_eq!(event.project_id, Some("-Users-name-project".to_string()));
    assert_eq!(event.session_id, Some("abc123".to_string()));
    assert!(event.is_subagent);
    assert_eq!(event.change_type, "add");
}

#[test]
fn test_parse_project_file_ignores_non_jsonl() {
    let projects = Path::new("/home/user/.claude/projects");
    let file = Path::new("/home/user/.claude/projects/-Users-name-project/README.md");
    assert!(parse_project_file(projects, file, "change").is_none());
}

#[test]
fn test_parse_project_file_ignores_wrong_depth() {
    let projects = Path::new("/home/user/.claude/projects");
    // Only 1 component (project dir itself, no file)
    let file = Path::new("/home/user/.claude/projects/-Users-name-project");
    assert!(parse_project_file(projects, file, "change").is_none());
}

#[test]
fn test_parse_project_file_ignores_3_components() {
    let projects = Path::new("/home/user/.claude/projects");
    // 3 components but not a subagent structure
    let file =
        Path::new("/home/user/.claude/projects/-Users-name-project/abc123/random.jsonl");
    assert!(parse_project_file(projects, file, "change").is_none());
}

#[test]
fn test_parse_todo_file() {
    let todos = Path::new("/home/user/.claude/todos");
    let file = Path::new("/home/user/.claude/todos/abc123.json");
    let event = parse_todo_file(todos, file, "change").unwrap();
    assert_eq!(event.session_id, Some("abc123".to_string()));
    assert!(event.project_id.is_none());
    assert!(!event.is_subagent);
    assert_eq!(event.change_type, "change");
}

#[test]
fn test_parse_todo_file_ignores_non_json() {
    let todos = Path::new("/home/user/.claude/todos");
    let file = Path::new("/home/user/.claude/todos/abc123.txt");
    assert!(parse_todo_file(todos, file, "change").is_none());
}

#[test]
fn test_parse_todo_file_unlink() {
    let todos = Path::new("/home/user/.claude/todos");
    let file = Path::new("/home/user/.claude/todos/session-uuid.json");
    let event = parse_todo_file(todos, file, "unlink").unwrap();
    assert_eq!(event.session_id, Some("session-uuid".to_string()));
    assert_eq!(event.change_type, "unlink");
}

#[test]
fn test_map_event_kind_create() {
    assert_eq!(
        map_event_kind(&EventKind::Create(notify::event::CreateKind::File)),
        Some("add")
    );
}

#[test]
fn test_map_event_kind_modify() {
    assert_eq!(
        map_event_kind(&EventKind::Modify(notify::event::ModifyKind::Data(
            notify::event::DataChange::Content
        ))),
        Some("change")
    );
}

#[test]
fn test_map_event_kind_remove() {
    assert_eq!(
        map_event_kind(&EventKind::Remove(notify::event::RemoveKind::File)),
        Some("unlink")
    );
}

#[test]
fn test_map_event_kind_access_returns_none() {
    assert_eq!(
        map_event_kind(&EventKind::Access(notify::event::AccessKind::Read)),
        None
    );
}

#[test]
fn test_map_event_kind_other_returns_none() {
    assert_eq!(map_event_kind(&EventKind::Other), None);
}

#[test]
fn test_parse_project_file_preserves_path() {
    let projects = Path::new("/home/user/.claude/projects");
    let file = Path::new("/home/user/.claude/projects/-Users-name-project/session1.jsonl");
    let event = parse_project_file(projects, file, "add").unwrap();
    assert_eq!(
        event.path,
        "/home/user/.claude/projects/-Users-name-project/session1.jsonl"
    );
}

#[test]
fn test_parse_project_file_different_change_types() {
    let projects = Path::new("/home/user/.claude/projects");
    let file = Path::new("/home/user/.claude/projects/-Users-name-project/s1.jsonl");
    for ct in &["add", "change", "unlink"] {
        let event = parse_project_file(projects, file, ct).unwrap();
        assert_eq!(event.change_type, *ct);
    }
}

#[test]
fn test_parse_todo_file_session_id_with_uuid() {
    let todos = Path::new("/home/user/.claude/todos");
    let file = Path::new("/home/user/.claude/todos/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json");
    let event = parse_todo_file(todos, file, "change").unwrap();
    assert_eq!(
        event.session_id,
        Some("a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_string())
    );
}

#[test]
fn test_resolve_claude_dir_uses_home() {
    // Should resolve to some path (either CLAUDE_ROOT or home/.claude)
    let result = resolve_claude_dir();
    assert!(result.is_some());
}
