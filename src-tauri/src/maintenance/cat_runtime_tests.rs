//! Ported from `internal/maintenance/cat_runtime_test.go`.

use std::collections::HashSet;

use chrono::{Duration, Utc};

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::{cutoff_default, scan_category};
use crate::maintenance::types::{Candidate, CategorySpec};

fn path_set(cands: &[Candidate]) -> HashSet<String> {
    cands.iter().map(|c| c.path.clone()).collect()
}

#[test]
fn test_scan_runtime_tasks() {
    let tmp = TempDir::new("runtime-tasks");
    let root = tmp.path();
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);
    let old = days_before(now_local, 10);
    let fresh = days_before(now_local, 1);
    let root_str = root.to_string_lossy().into_owned();

    // Old normal task dir (real state file + a lock marker).
    let normal = "11111111-0000-0000-0000-000000000001";
    write_aged(&root.join("tasks").join(normal).join("state.json"), "{}", old);
    write_aged(&root.join("tasks").join(normal).join(".lock"), "", old);
    set_mtime(&root.join("tasks").join(normal), old);

    // Old marker-only task dir.
    let marker = "22222222-0000-0000-0000-000000000002";
    write_aged(&root.join("tasks").join(marker).join(".lock"), "", old);
    write_aged(&root.join("tasks").join(marker).join(".highwatermark"), "", old);
    set_mtime(&root.join("tasks").join(marker), old);

    // Fresh normal task dir (younger than cutoff).
    let fresh_uuid = "33333333-0000-0000-0000-000000000003";
    write_aged(&root.join("tasks").join(fresh_uuid).join("state.json"), "{}", fresh);
    set_mtime(&root.join("tasks").join(fresh_uuid), fresh);

    // Today's task dir → never a candidate.
    let today = "44444444-0000-0000-0000-000000000004";
    write_aged(&root.join("tasks").join(today).join("state.json"), "{}", now_local);

    let tasks_cands = scan_category(&CategorySpec {
        id: "runtime-tasks".to_string(),
        root: root_str.clone(),
        now,
        cutoff: Some((now_local - Duration::days(7)).with_timezone(&Utc)),
        ..Default::default()
    })
    .unwrap();
    let tasks = path_set(&tasks_cands);
    assert!(tasks.contains(&root.join("tasks").join(normal).to_string_lossy().into_owned()));
    assert!(!tasks.contains(&root.join("tasks").join(marker).to_string_lossy().into_owned()));
    assert!(!tasks.contains(&root.join("tasks").join(fresh_uuid).to_string_lossy().into_owned()));
    assert!(!tasks.contains(&root.join("tasks").join(today).to_string_lossy().into_owned()));

    let empty_cands = scan_category(&CategorySpec {
        id: "runtime-tasks-empty".to_string(),
        root: root_str,
        now,
        cutoff: Some((now_local - Duration::days(2)).with_timezone(&Utc)),
        ..Default::default()
    })
    .unwrap();
    let empty = path_set(&empty_cands);
    assert!(empty.contains(&root.join("tasks").join(marker).to_string_lossy().into_owned()));
    assert!(!empty.contains(&root.join("tasks").join(normal).to_string_lossy().into_owned()));
}

#[test]
fn test_scan_runtime_jobs_protects_pins() {
    let tmp = TempDir::new("runtime-jobs");
    let root = tmp.path();
    let now_local = test_now();
    let old = days_before(now_local, 10);

    write_aged(&root.join("jobs").join("pins.json"), "{}", old);
    let other = write_aged(&root.join("jobs").join("job-42.json"), "{}", old);
    write_aged(&root.join("jobs").join("today.json"), "{}", now_local);

    let cands = scan_category(&CategorySpec {
        id: "runtime-jobs".to_string(),
        root: root.to_string_lossy().into_owned(),
        now: now_local.with_timezone(&Utc),
        cutoff: Some((now_local - Duration::days(7)).with_timezone(&Utc)),
        ..Default::default()
    })
    .unwrap();
    assert_eq!(cands.len(), 1, "only the old non-pins job: {cands:?}");
    assert_eq!(cands[0].path, other);
}

#[test]
fn test_scan_runtime_sessions_excludes_fresh_and_today() {
    let tmp = TempDir::new("runtime-sessions");
    let root = tmp.path();
    let now_local = test_now();

    let stale = write_aged(
        &root.join("sessions").join("old-session.json"),
        "{}",
        days_before(now_local, 10),
    );
    write_aged(&root.join("sessions").join("fresh-session.json"), "{}", days_before(now_local, 1));
    write_aged(&root.join("sessions").join("today-session.json"), "{}", now_local);

    let cands = scan_category(&CategorySpec {
        id: "runtime-sessions".to_string(),
        root: root.to_string_lossy().into_owned(),
        now: now_local.with_timezone(&Utc),
        cutoff: Some((now_local - Duration::days(7)).with_timezone(&Utc)),
        ..Default::default()
    })
    .unwrap();
    assert_eq!(cands.len(), 1, "only the stale session file: {cands:?}");
    assert_eq!(cands[0].path, stale);
}

#[test]
fn test_scan_runtime_all_families_registered() {
    let tmp = TempDir::new("runtime-all");
    let root = tmp.path();
    let now = test_now().with_timezone(&Utc);
    for id in [
        "runtime-tasks",
        "runtime-tasks-empty",
        "runtime-jobs",
        "runtime-sessions",
        "runtime-session-env",
        "runtime-shell-snapshots",
    ] {
        let spec = CategorySpec {
            id: id.to_string(),
            root: root.to_string_lossy().into_owned(),
            now,
            ..Default::default()
        };
        assert!(scan_category(&spec).is_ok(), "{id}: unexpected error on empty root");
    }
}

#[test]
fn test_runtime_cutoff_defaults() {
    let want = [
        ("runtime-tasks", 7),
        ("runtime-tasks-empty", 2),
        ("runtime-jobs", 7),
        ("runtime-sessions", 7),
        ("runtime-session-env", 7),
        ("runtime-shell-snapshots", 7),
    ];
    for (id, days) in want {
        assert_eq!(cutoff_default(id), days, "{id}");
    }
}
