//! Ports `prune_policy_test.go` + the `manager.rs` CRUD cases from
//! `notifications_test.go`. Uses unique temp files only (never the real store).

use super::*;
use crate::notifications::types::{DetectedError, ErrorContext, StoredNotification};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_path(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "notif-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("n.json")
}

fn detected(id: &str) -> DetectedError {
    DetectedError {
        id: id.to_string(),
        timestamp: 0.0,
        session_id: "sess1".into(),
        project_id: "proj1".into(),
        file_path: "/tmp/test.jsonl".into(),
        source: "Bash".into(),
        message: "error occurred".into(),
        line_number: None,
        tool_use_id: None,
        subagent_id: None,
        trigger_color: None,
        trigger_id: None,
        trigger_name: None,
        context: ErrorContext {
            project_name: "proj".into(),
            cwd: None,
        },
    }
}

fn stored(created_at: f64, is_read: bool) -> StoredNotification {
    StoredNotification {
        error: detected("x"),
        is_read,
        created_at,
    }
}

// ── prune_policy_test.go ────────────────────────────────────────────────────

#[test]
fn prune_age_drop() {
    let s = NotificationState::new_at(temp_path("age"));
    let now = now_ms();
    {
        let mut inner = s.inner.lock().unwrap();
        inner.notifications = vec![
            stored(now, false),                        // fresh
            stored(now - 40.0 * MS_PER_DAY, false),    // 40d old → dropped by 30d retention
            stored(now - 5.0 * MS_PER_DAY, false),     // recent
        ];
    }
    s.set_policy(30, 200);
    let inner = s.inner.lock().unwrap();
    assert_eq!(inner.notifications.len(), 2, "age prune: 40d entry should be dropped");
    for n in &inner.notifications {
        assert!(
            n.created_at >= now - 30.0 * MS_PER_DAY,
            "an entry older than the retention window survived"
        );
    }
}

#[test]
fn prune_count_unread_outlive_read() {
    let s = NotificationState::new_at(temp_path("count"));
    let now = now_ms();
    {
        let mut inner = s.inner.lock().unwrap();
        // 10 entries, alternating read; even index = read, older as index grows.
        inner.notifications = (0..10)
            .map(|i| stored(now - (i as f64) * 1000.0, i % 2 == 0))
            .collect();
    }
    s.set_policy(0, 4); // no age gate, cap 4

    let inner = s.inner.lock().unwrap();
    assert_eq!(inner.notifications.len(), 4, "count cap: want 4 kept");
    for n in &inner.notifications {
        assert!(
            !n.is_read,
            "under count pressure, read notifications should be dropped before unread"
        );
    }
}

// ── manager.rs CRUD ─────────────────────────────────────────────────────────

#[test]
fn manager_crud() {
    let s = NotificationState::new_at(temp_path("crud"));

    let e = DetectedError {
        id: "test-id-1".into(),
        message: "error occurred".into(),
        ..detected("test-id-1")
    };
    let stored = s.add_error(e).expect("AddError should return stored notification");
    assert!(!stored.is_read, "new notification should be unread");

    let result = s.get_notifications(None);
    assert_eq!(result.total, 1);
    assert_eq!(result.unread_count, 1);

    assert!(s.mark_read("test-id-1"), "MarkRead should return true");
    assert_eq!(s.unread_count(), 0);

    assert!(s.delete_notification("test-id-1"), "DeleteNotification should return true");
    assert_eq!(s.get_notifications(None).total, 0);
}

#[test]
fn manager_deduplicate_by_tool_use_id() {
    let s = NotificationState::new_at(temp_path("dedup"));

    let tool_id = "tool-abc".to_string();
    let mut e1 = detected("notif-1");
    e1.tool_use_id = Some(tool_id.clone());
    assert!(s.add_error(e1.clone()).is_some(), "first AddError should succeed");

    // Same tool_use_id without subagent → dedup (reject).
    let mut e2 = e1.clone();
    e2.id = "notif-2".into();
    assert!(
        s.add_error(e2).is_none(),
        "duplicate tool_use_id without upgrade should be deduplicated"
    );

    // Same tool_use_id but now with subagent → replace.
    let mut e3 = e1.clone();
    e3.id = "notif-3".into();
    e3.subagent_id = Some("sub-agent-1".into());
    assert!(
        s.add_error(e3).is_some(),
        "subagent-annotated version should replace earlier one"
    );

    assert_eq!(s.get_notifications(None).total, 1, "total after replace");
}

#[test]
fn manager_mark_all_read() {
    let s = NotificationState::new_at(temp_path("markall"));
    for i in 0..3 {
        s.add_error(detected(&format!("id-{i}")));
    }
    s.mark_all_read();
    assert_eq!(s.unread_count(), 0);
}

#[test]
fn manager_clear_all() {
    let s = NotificationState::new_at(temp_path("clear"));
    s.add_error(detected("x"));
    s.clear_all();
    assert_eq!(s.get_notifications(None).total, 0);
}
