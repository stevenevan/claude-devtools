//! Ports the store cases: newest-first enumeration + directory deletion. Uses
//! isolated temp dirs — never touches real `~/.claude`.

use super::*;
use crate::configbackup::types::{config_backups_dir, Manifest};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "configbackup-store-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn seed_manifest(app_data_dir: &Path, id: &str, created_ms: f64) -> Manifest {
    let backup_dir = config_backups_dir(app_data_dir).join(id);
    fs::create_dir_all(&backup_dir).unwrap();
    let m = Manifest {
        id: id.to_string(),
        label: format!("label-{id}"),
        created_ms,
        secrets_included: false,
        files: Vec::new(),
        skill_links: Vec::new(),
    };
    write_manifest(&backup_dir, &m).unwrap();
    m
}

#[test]
fn list_returns_newest_first() {
    let app = temp_dir("list");
    seed_manifest(&app, "older", 100.0);
    seed_manifest(&app, "newest", 300.0);
    seed_manifest(&app, "middle", 200.0);

    let list = list_config_backups(&app).unwrap();
    let ids: Vec<&str> = list.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["newest", "middle", "older"]);
}

#[test]
fn list_missing_store_is_empty() {
    let app = temp_dir("empty");
    assert!(list_config_backups(&app).unwrap().is_empty());
}

#[test]
fn list_skips_corrupt_manifest() {
    let app = temp_dir("corrupt");
    seed_manifest(&app, "good", 100.0);
    let bad_dir = config_backups_dir(&app).join("bad");
    fs::create_dir_all(&bad_dir).unwrap();
    fs::write(bad_dir.join("manifest.json"), b"not json").unwrap();

    let list = list_config_backups(&app).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "good");
}

#[test]
fn write_then_read_round_trips() {
    let app = temp_dir("roundtrip");
    let written = seed_manifest(&app, "rt", 42.5);
    let read = read_manifest(&config_backups_dir(&app).join("rt")).unwrap();
    assert_eq!(read.id, written.id);
    assert_eq!(read.created_ms, 42.5);
    assert_eq!(read.label, "label-rt");
}

#[test]
fn manifest_is_written_mode_0600() {
    let app = temp_dir("mode");
    seed_manifest(&app, "m", 1.0);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = fs::metadata(config_backups_dir(&app).join("m").join("manifest.json")).unwrap();
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    }
}

#[test]
fn delete_removes_backup_tree() {
    let app = temp_dir("delete");
    seed_manifest(&app, "victim", 1.0);
    let target = config_backups_dir(&app).join("victim");
    assert!(target.exists());

    delete_config_backup(&app, "victim").unwrap();
    assert!(!target.exists());

    // A second delete (now missing) is a no-op, mirroring os.RemoveAll.
    delete_config_backup(&app, "victim").unwrap();
}

#[test]
fn delete_rejects_invalid_id() {
    let app = temp_dir("delete-bad");
    assert!(delete_config_backup(&app, "../escape").is_err());
    assert!(delete_config_backup(&app, "/abs").is_err());
}
