//! Smoke tests for the binary rollback (Go has no `rollback_test.go`). Verifies
//! the atomic swap, the trash-prior ordering, and the forced owner-exec bit —
//! using canonicalized temp dirs + a fake trash closure (never the trash engine).

use super::*;
use std::fs;
use std::os::unix::fs::PermissionsExt;
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
        "maint-rollback-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

fn write_mode(path: &Path, content: &str, mode: u32) {
    fs::write(path, content).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

#[test]
fn rollback_swaps_contents_trashes_prior_and_forces_exec() {
    let root = make_temp_dir("root");
    let app_data = make_temp_dir("appdata");
    let app_data_str = app_data.to_string_lossy().into_owned();

    let active = root.join("active.bin");
    let backup = root.join("backup.bin");
    write_mode(&active, "ACTIVE", 0o644); // mode-stripped .bak scenario (no +x)
    write_mode(&backup, "BACKUP", 0o644);

    let roots = vec![
        root.to_string_lossy().into_owned(),
        app_data_str.clone(),
    ];

    // Fake trash: record the paths it was handed, return them as the "receipt".
    let trash = |paths: &[String]| -> Result<Vec<String>, String> { Ok(paths.to_vec()) };

    let receipt = rollback_binary(
        &roots,
        &app_data_str,
        &active.to_string_lossy(),
        &backup.to_string_lossy(),
        trash,
    )
    .unwrap();

    // Trash-prior: exactly one item, a copy of the prior active under rollback-tmp.
    assert_eq!(receipt.len(), 1, "prior active must be trashed as one item");
    assert!(
        receipt[0].contains("rollback-tmp"),
        "trashed copy lives under appData/rollback-tmp: {}",
        receipt[0]
    );

    // Atomic swap: the active now holds the backup's contents.
    assert_eq!(fs::read_to_string(&active).unwrap(), "BACKUP");

    // Owner-exec forced even though the source was 0o644.
    let mode = fs::symlink_metadata(&active).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode & 0o100, 0o100, "owner-exec must be forced, got {mode:o}");
}

#[test]
fn rollback_refuses_symlinked_active() {
    let root = make_temp_dir("symlink-root");
    let app_data = make_temp_dir("symlink-appdata");
    let app_data_str = app_data.to_string_lossy().into_owned();

    let real = root.join("real.bin");
    write_mode(&real, "REAL", 0o755);
    let active = root.join("active.bin");
    if std::os::unix::fs::symlink(&real, &active).is_err() {
        return; // symlink unsupported — skip
    }
    let backup = root.join("backup.bin");
    write_mode(&backup, "BACKUP", 0o755);

    let roots = vec![root.to_string_lossy().into_owned(), app_data_str.clone()];
    let trash = |paths: &[String]| -> Result<Vec<String>, String> { Ok(paths.to_vec()) };

    let err = rollback_binary(
        &roots,
        &app_data_str,
        &active.to_string_lossy(),
        &backup.to_string_lossy(),
        trash,
    );
    assert!(err.is_err(), "must refuse a symlinked active leaf");
}
