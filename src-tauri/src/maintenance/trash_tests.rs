//! Ports `trash_test.go` (+ `trash_exdev_linux_test.go`). Uses env::temp_dir +
//! unique canonicalized subdirs (no `tempfile` dep); NEVER touches real
//! `~/.claude`.

use super::*;

use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn make_temp_dir() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("trash-test-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    // Canonicalize so paths match the /private/... form macOS reports and Go's
    // EvalSymlinks-based canonicalization would produce.
    fs::canonicalize(&dir).unwrap()
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn must_write(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn must_exist(path: &Path) {
    fs::symlink_metadata(path).unwrap_or_else(|e| panic!("expected {path:?} to exist: {e}"));
}

fn must_not_exist(path: &Path) {
    if fs::symlink_metadata(path).is_ok() {
        panic!("expected {path:?} to not exist");
    }
}

fn perm(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

// ─── confinement / self-nuke ────────────────────────────────────────────────

#[test]
fn trash_items_etc_hosts_rejected() {
    let Ok(before) = fs::read("/etc/hosts") else {
        return; // /etc/hosts not readable in this environment — skip
    };
    let root = make_temp_dir();
    let app_data = make_temp_dir();

    let err = trash_items(&[s(&root)], &s(&app_data), &["/etc/hosts".to_string()]);
    assert!(err.is_err(), "expected an error trashing /etc/hosts");

    let after = fs::read("/etc/hosts").unwrap();
    assert_eq!(before, after, "/etc/hosts changed — trash touched an out-of-root file");
}

#[test]
fn trash_items_out_of_root_rejected() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let outside = make_temp_dir();
    let target = outside.join("secret.txt");
    must_write(&target, "do not touch");

    let err = trash_items(&[s(&root)], &s(&app_data), &[s(&target)]);
    assert!(err.is_err(), "expected an error trashing a path outside root");
    must_exist(&target);
}

#[test]
fn trash_items_symlink_target_outside_root_intact() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let outside = make_temp_dir();
    let target_file = outside.join("target").join("bigfile.bin");
    must_write(&target_file, "0123456789");

    let target_dir = outside.join("target");
    let link = root.join("link");
    symlink(&target_dir, &link).unwrap();

    let receipt = trash_items(&[s(&root)], &s(&app_data), &[s(&link)]).expect("TrashItems");

    must_not_exist(&link);
    must_exist(&target_file); // target untouched

    assert_eq!(receipt.items.len(), 1);
    assert_eq!(
        receipt.items[0].bytes, 0,
        "symlink item bytes must be 0 (never follow the target)"
    );

    // The trashed entry must itself still be a symlink pointing at the original.
    let stored = app_data
        .join("trash")
        .join(&receipt.id)
        .join(&receipt.items[0].rel_store);
    let lst = fs::symlink_metadata(&stored).unwrap();
    assert!(
        lst.file_type().is_symlink(),
        "trashed entry is not a symlink — target may have been dereferenced"
    );
    assert_eq!(fs::read_link(&stored).unwrap(), target_dir);
}

#[test]
fn trash_items_no_nest_rejected() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let dir = root.join("foo");
    let inner = dir.join("bar.txt");
    must_write(&inner, "x");

    let err = trash_items(&[s(&root)], &s(&app_data), &[s(&dir), s(&inner)]);
    assert!(err.is_err(), "expected nesting rejection");
    must_exist(&dir);
    must_exist(&inner);
}

#[test]
fn trash_items_self_nuke_rejected() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();

    assert!(
        trash_items(&[s(&root)], &s(&app_data), &[s(&root)]).is_err(),
        "expected root self-nuke to be rejected"
    );
    assert!(
        trash_items(&[s(&root)], &s(&app_data), &[s(&app_data)]).is_err(),
        "expected app-data self-nuke to be rejected"
    );

    // Seed one legitimate receipt, then try to trash the trash tree itself.
    let seed_file = root.join("seed.txt");
    must_write(&seed_file, "x");
    let receipt = trash_items(&[s(&root)], &s(&app_data), &[s(&seed_file)]).expect("seed trash");
    let trash_tree = app_data.join("trash").join(&receipt.id);
    assert!(
        trash_items(&[s(&root)], &s(&app_data), &[s(&trash_tree)]).is_err(),
        "expected trashing the trash tree itself to be rejected"
    );
}

// ─── round trips ────────────────────────────────────────────────────────────

#[test]
fn trash_items_mixed_root_same_basename_no_collision() {
    let root_a = make_temp_dir();
    let root_b = make_temp_dir();
    let app_data = make_temp_dir();

    let file_a = root_a.join("notes.txt");
    let file_b = root_b.join("notes.txt");
    must_write(&file_a, "from A");
    must_write(&file_b, "from B");

    let roots = vec![s(&root_a), s(&root_b)];
    let receipt = trash_items(&roots, &s(&app_data), &[s(&file_a), s(&file_b)]).expect("TrashItems");
    assert_eq!(receipt.items.len(), 2);
    assert_ne!(
        receipt.items[0].rel_store, receipt.items[1].rel_store,
        "RelStore collision"
    );
    must_not_exist(&file_a);
    must_not_exist(&file_b);

    restore_trash(&roots, &s(&app_data), &receipt.id).expect("RestoreTrash");
    assert_eq!(fs::read_to_string(&file_a).unwrap(), "from A");
    assert_eq!(fs::read_to_string(&file_b).unwrap(), "from B");
}

#[test]
fn trash_items_directory_round_trip() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let dir = root.join("project");
    must_write(&dir.join("a.txt"), "alpha");
    must_write(&dir.join("sub").join("b.txt"), "beta");

    let roots = vec![s(&root)];
    let receipt = trash_items(&roots, &s(&app_data), &[s(&dir)]).expect("TrashItems");
    must_not_exist(&dir);

    let list = list_trash(&s(&app_data)).expect("ListTrash");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, receipt.id);

    restore_trash(&roots, &s(&app_data), &receipt.id).expect("RestoreTrash");
    assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "alpha");
    assert_eq!(fs::read_to_string(dir.join("sub").join("b.txt")).unwrap(), "beta");

    let list = list_trash(&s(&app_data)).expect("ListTrash after restore");
    assert!(list.is_empty(), "expected the spent receipt to be gone");
}

// ─── receipt-id validation ──────────────────────────────────────────────────

#[test]
fn restore_trash_receipt_id_pattern_rejected() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    assert!(
        restore_trash(&[s(&root)], &s(&app_data), "../../etc").is_err(),
        "expected receipt id pattern rejection"
    );
}

#[test]
fn empty_trash_receipt_id_pattern_rejected() {
    let app_data = make_temp_dir();
    assert!(
        empty_trash(&s(&app_data), &["../../etc".to_string()]).is_err(),
        "expected receipt id pattern rejection"
    );
    must_not_exist(&app_data.join("etc"));
}

// ─── malicious manifests ────────────────────────────────────────────────────

/// Hand-builds a receipt directory + manifest.json outside `trash_items`, the
/// same way a restored backup or a buggy consumer might inject a malicious field.
fn fabricate_receipt(app_data: &Path, items: Vec<TrashedItem>) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let r_dir = app_data.join("trash").join(&id);
    fs::create_dir_all(&r_dir).unwrap();
    let receipt = TrashReceipt {
        id: id.clone(),
        trashed_at: Utc::now(),
        items,
    };
    let data = serde_json::to_vec(&receipt).unwrap();
    fs::write(r_dir.join("manifest.json"), data).unwrap();
    id
}

#[test]
fn restore_trash_malicious_orig_path_rejected() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let evil_dest = make_temp_dir().join("evil-should-not-exist");

    let id = fabricate_receipt(
        &app_data,
        vec![TrashedItem {
            orig_path: s(&evil_dest),
            rel_store: "0/whatever.txt".to_string(),
            bytes: 1,
        }],
    );
    // Back the manifest entry with a real (harmless) file so a source-side check
    // alone wouldn't be the one rejecting this.
    must_write(&app_data.join("trash").join(&id).join("0").join("whatever.txt"), "x");

    assert!(
        restore_trash(&[s(&root)], &s(&app_data), &id).is_err(),
        "expected malicious OrigPath to be rejected"
    );
    must_not_exist(&evil_dest);
}

#[test]
fn restore_trash_malicious_rel_store_rejected() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let legit_dest = root.join("restored.txt");

    let id = fabricate_receipt(
        &app_data,
        vec![TrashedItem {
            orig_path: s(&legit_dest),
            rel_store: "../../../../../../etc/passwd".to_string(),
            bytes: 1,
        }],
    );

    assert!(
        restore_trash(&[s(&root)], &s(&app_data), &id).is_err(),
        "expected malicious RelStore to be rejected"
    );
    must_not_exist(&legit_dest);
}

#[test]
fn restore_trash_conflict_no_overwrite() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let orig_path = root.join("keep.txt");
    must_write(&orig_path, "will be trashed");

    let roots = vec![s(&root)];
    let receipt = trash_items(&roots, &s(&app_data), &[s(&orig_path)]).expect("TrashItems");

    // Something re-creates a file at the original path before restore.
    must_write(&orig_path, "conflicting content");

    assert!(
        restore_trash(&roots, &s(&app_data), &receipt.id).is_err(),
        "expected a restore conflict"
    );
    assert_eq!(fs::read_to_string(&orig_path).unwrap(), "conflicting content");

    // The trashed copy must still be sitting in the receipt, untouched.
    let stored = app_data
        .join("trash")
        .join(&receipt.id)
        .join(&receipt.items[0].rel_store);
    assert_eq!(fs::read_to_string(&stored).unwrap(), "will be trashed");
}

// ─── perms / bytes / copy-fallback correctness ──────────────────────────────

#[test]
fn trash_items_perm_bits() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let orig_path = root.join("file.txt");
    must_write(&orig_path, "x");

    let receipt = trash_items(&[s(&root)], &s(&app_data), &[s(&orig_path)]).expect("TrashItems");

    let r_dir = app_data.join("trash").join(&receipt.id);
    assert_eq!(perm(&r_dir), 0o700, "receipt dir perm");
    assert_eq!(perm(&r_dir.join("manifest.json")), 0o600, "manifest.json perm");
}

#[test]
fn empty_trash_frees_bytes() {
    let root = make_temp_dir();
    let app_data = make_temp_dir();
    let orig_path = root.join("big.bin");
    must_write(&orig_path, &"0".repeat(5000));

    let receipt = trash_items(&[s(&root)], &s(&app_data), &[s(&orig_path)]).expect("TrashItems");

    let before = path_bytes(&s(&app_data)).expect("bytes before");
    assert!(before > 0, "expected non-zero bytes in app-data dir before emptying");

    empty_trash(&s(&app_data), &[receipt.id.clone()]).expect("EmptyTrash");

    let after = path_bytes(&s(&app_data)).expect("bytes after");
    assert!(after < before, "expected bytes to decrease: before={before} after={after}");

    assert!(list_trash(&s(&app_data)).expect("ListTrash").is_empty());
}

#[test]
fn copy_recursive_preserves_symlink_and_mode() {
    let src = make_temp_dir();
    let dst = make_temp_dir().join("copy-dst");

    let secure_path = src.join("secret.jsonl");
    fs::write(&secure_path, "session data").unwrap();
    fs::set_permissions(&secure_path, fs::Permissions::from_mode(0o600)).unwrap();
    let link = src.join("alias");
    symlink(&secure_path, &link).unwrap();

    copy_recursive(&s(&src), &s(&dst)).expect("copyRecursive");

    let copied_file = dst.join("secret.jsonl");
    assert_eq!(perm(&copied_file), 0o600, "copied file mode not preserved");
    assert_eq!(fs::read_to_string(&copied_file).unwrap(), "session data");

    let copied_link = dst.join("alias");
    let lst = fs::symlink_metadata(&copied_link).unwrap();
    assert!(lst.file_type().is_symlink(), "copied entry was dereferenced");
    assert_eq!(fs::read_link(&copied_link).unwrap(), secure_path);
}

// ─── EXDEV cross-device fallback (Linux only) ───────────────────────────────

// Mirrors trash_exdev_linux_test.go: mount a tmpfs on the trash side so the
// rename crosses filesystems (real EXDEV), forcing the copy-verify-delete path.
// Mounting needs CAP_SYS_ADMIN; skip cleanly wherever that isn't available.
#[cfg(target_os = "linux")]
#[test]
fn trash_items_exdev_fallback() {
    let mount_point = make_temp_dir();
    let mounted = std::process::Command::new("mount")
        .args(["-t", "tmpfs", "tmpfs", &s(&mount_point)])
        .status()
        .map(|st| st.success())
        .unwrap_or(false);
    if !mounted {
        return; // cannot mount (needs CAP_SYS_ADMIN) — skip
    }
    struct Unmount(String);
    impl Drop for Unmount {
        fn drop(&mut self) {
            let _ = std::process::Command::new("umount").arg(&self.0).status();
        }
    }
    let _guard = Unmount(s(&mount_point));

    let root = make_temp_dir();
    let app_data = mount_point.clone(); // trash side forced onto a different fs

    let dir = root.join("project");
    let secure_path = dir.join("secret.jsonl");
    fs::create_dir_all(&dir).unwrap();
    fs::write(&secure_path, "session data").unwrap();
    fs::set_permissions(&secure_path, fs::Permissions::from_mode(0o600)).unwrap();
    symlink(&secure_path, dir.join("alias")).unwrap();

    let roots = vec![s(&root)];
    let receipt = trash_items(&roots, &s(&app_data), &[s(&dir)]).expect("TrashItems");
    must_not_exist(&dir);

    let stored_dir = app_data.join("trash").join(&receipt.id).join(&receipt.items[0].rel_store);
    assert_eq!(perm(&stored_dir.join("secret.jsonl")), 0o600, "copied file mode");
    let stored_link = fs::symlink_metadata(stored_dir.join("alias")).unwrap();
    assert!(stored_link.file_type().is_symlink(), "dereferenced during EXDEV copy");

    restore_trash(&roots, &s(&app_data), &receipt.id).expect("RestoreTrash across EXDEV");
    assert_eq!(fs::read_to_string(&secure_path).unwrap(), "session data");
}
