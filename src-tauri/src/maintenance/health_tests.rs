//! Ports `internal/maintenance/health_test.go`. Uses unique temp dirs; the
//! reader is read-only so no trash/closure wiring is needed.

use super::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn make_temp_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "maint-health-{tag}-{}-{nanos}-{n}",
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

#[test]
fn test_maintenance_health() {
    let root = make_temp_dir("ok");
    write_file(&root.join(".last-cleanup"), "2026-07-01");
    write_file(
        &root.join(".last-update-result.json"),
        r#"{"status":"ok","version":"1.2.3"}"#,
    );
    write_file(&root.join(".caveman-active"), "full");
    // daemon.log with many lines to exercise the tail.
    let body = "daemon line\n".repeat(500);
    write_file(&root.join("daemon.log"), &body);

    let h = maintenance_health(&root.to_string_lossy()).unwrap();

    assert!(
        h.last_cleanup_ms != 0.0 && h.last_cleanup_raw == "2026-07-01",
        "last-cleanup not read: ms={} raw={:?}",
        h.last_cleanup_ms,
        h.last_cleanup_raw
    );
    assert!(
        h.last_update_status == "ok"
            && h.last_update_version == "1.2.3"
            && !h.last_update_parse_err,
        "last-update parse wrong: {h:?}"
    );
    assert!(
        h.daemon_present && h.daemon_tail.len() == DAEMON_TAIL_LINES,
        "daemon tail should be last {DAEMON_TAIL_LINES} lines, got {}",
        h.daemon_tail.len()
    );
    let caveman = h
        .flags
        .iter()
        .any(|f| f.name == ".caveman-active" && f.present && f.content == "full");
    assert!(caveman, "caveman flag not read: {:?}", h.flags);
}

#[test]
fn test_maintenance_health_missing_and_malformed() {
    let root = make_temp_dir("missing");
    // nothing but a malformed update file.
    fs::write(root.join(".last-update-result.json"), "{not json").unwrap();

    let h = maintenance_health(&root.to_string_lossy()).unwrap();

    assert_eq!(
        h.last_cleanup_ms, 0.0,
        "missing .last-cleanup should be 0/absent, not an error"
    );
    assert!(
        h.last_update_parse_err && !h.last_update_raw.is_empty(),
        "malformed update file should set parseErr + keep raw"
    );
    assert!(!h.daemon_present, "missing daemon.log should not be present");
    // Flags always cover the allowlist (present=false when absent).
    assert_eq!(
        h.flags.len(),
        KNOWN_FLAG_FILES.len(),
        "flags list should always cover the allowlist"
    );
}
