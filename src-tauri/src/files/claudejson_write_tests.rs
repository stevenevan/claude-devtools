//! Ports `claudejson_write_test.go` — the guarded-purge safety cases: value-
//! preserving stale delete, non-project/live/unverifiable rejection, corrupt-file
//! untouched, app backup+restore, the CAS-race conflict path, and restore
//! bad-name guards.

use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::value::RawValue;

use super::*;
use crate::files::claudejson::claudejson_test_support::*;

type RawMap = BTreeMap<String, Box<RawValue>>;

fn read_json_file(path: &std::path::Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

fn top_map(bytes: &[u8]) -> RawMap {
    serde_json::from_slice(bytes).unwrap()
}

fn projects_map(top: &RawMap) -> RawMap {
    serde_json::from_str(top["projects"].get()).unwrap()
}

#[test]
fn purge_removes_stale_and_preserves_values() {
    let h = claude_json_home();
    let live = h.home.join("liveworkdir");
    std::fs::create_dir_all(&live).unwrap();
    let live = live.to_string_lossy().into_owned();
    let pre = big_fixture_bytes(&live, None);
    write_claude_json(&h.home, &pre, 0o600);
    let pre_top = top_map(&pre);

    let stale = vec![
        "/zzz_stale_one".to_string(),
        "/zzz_stale_two".to_string(),
        "/zzz_stale_three".to_string(),
    ];
    let res = purge_claude_json_projects(&stale).expect("purge");
    assert_eq!(res.removed_keys.len(), 3);
    assert!(res.bytes_after < res.bytes_before, "expected file to shrink");

    let out = read_json_file(&h.home.join(".claude.json"));
    assert!(super::json_valid(&out), "output is not valid JSON");
    assert!(
        out.windows(4).any(|w| w == b"\n  \""),
        "output is not 2-space pretty-printed"
    );

    let out_top = top_map(&out);
    for (k, pre_val) in &pre_top {
        if k == "projects" {
            continue;
        }
        let out_val = out_top.get(k).unwrap_or_else(|| panic!("top-level key {k:?} dropped"));
        assert!(
            super::compact_raw_equal(pre_val.get(), out_val.get()),
            "top-level value {k:?} changed"
        );
    }

    let out_str = String::from_utf8(out.clone()).unwrap();
    assert!(out_str.contains("123456789012345678901234567890"), "big integer not preserved");
    assert!(out_str.contains(FIXTURE_EMAIL), "oauthAccount email not preserved");

    let out_pm = projects_map(&out_top);
    for k in &stale {
        assert!(!out_pm.contains_key(k), "purged key {k:?} still present");
    }
    for k in [live.as_str(), "/zzz-unverifiable-dir"] {
        assert!(out_pm.contains_key(k), "non-purged project {k:?} was removed");
    }
}

#[test]
fn purge_rejects_non_project_key() {
    let h = claude_json_home();
    let live = h.home.join("liveworkdir");
    std::fs::create_dir_all(&live).unwrap();
    let live = live.to_string_lossy().into_owned();
    let pre = big_fixture_bytes(&live, None);
    write_claude_json(&h.home, &pre, 0o600);

    for k in ["oauthAccount", "numStartups", "bigIntField"] {
        assert!(
            purge_claude_json_projects(&[k.to_string()]).is_err(),
            "purge({k:?}) should be rejected"
        );
    }
    let after = read_json_file(&h.home.join(".claude.json"));
    assert_eq!(after, pre, "file mutated after a rejected purge");
    assert_eq!(list_claude_json_app_backups().unwrap().len(), 0, "rejected purge created backups");
}

#[test]
fn purge_corrupt_untouched() {
    let h = claude_json_home();
    let corrupt = b"{ not valid json";
    std::fs::write(h.home.join(".claude.json"), corrupt).unwrap();

    assert!(
        purge_claude_json_projects(&["/whatever".to_string()]).is_err(),
        "purge of a corrupt file should error"
    );
    let after = read_json_file(&h.home.join(".claude.json"));
    assert_eq!(after.as_slice(), corrupt.as_slice(), "corrupt file was modified");
    assert_eq!(list_claude_json_app_backups().unwrap().len(), 0, "corrupt purge created backups");
}

#[test]
fn purge_rejects_live_or_unverifiable() {
    let h = claude_json_home();
    let live = h.home.join("liveworkdir");
    std::fs::create_dir_all(&live).unwrap();
    let live = live.to_string_lossy().into_owned();
    let pre = big_fixture_bytes(&live, None);
    write_claude_json(&h.home, &pre, 0o600);

    for k in [live.as_str(), "/zzz-unverifiable-dir"] {
        assert!(
            purge_claude_json_projects(&[k.to_string()]).is_err(),
            "purge({k:?}) should be rejected (not stale)"
        );
    }
    // Mixed request (one stale + one live) rejects the WHOLE purge — no partial.
    assert!(
        purge_claude_json_projects(&["/zzz_stale_one".to_string(), live.clone()]).is_err(),
        "mixed stale+live purge should be rejected wholesale"
    );
    let after = read_json_file(&h.home.join(".claude.json"));
    assert_eq!(after, pre, "file mutated after a rejected purge");
    assert_eq!(list_claude_json_app_backups().unwrap().len(), 0, "rejected purge created backups");
}

#[test]
fn app_backup_and_restore() {
    let h = claude_json_home();
    let live = h.home.join("liveworkdir");
    std::fs::create_dir_all(&live).unwrap();
    let live = live.to_string_lossy().into_owned();
    let pre = big_fixture_bytes(&live, None);
    write_claude_json(&h.home, &pre, 0o600);

    let res = purge_claude_json_projects(&["/zzz_stale_one".to_string()]).expect("purge");
    assert!(!res.backup_name.is_empty(), "purge did not report a backup name");

    let dir = super::claude_json_app_backups_dir().unwrap();
    let d_mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
    assert_eq!(d_mode, 0o700, "backups dir mode = {d_mode:o}, want 700");

    let b_path = dir.join(&res.backup_name);
    let b_mode = std::fs::metadata(&b_path).unwrap().permissions().mode() & 0o777;
    assert_eq!(b_mode, 0o600, "backup file mode = {b_mode:o}, want 600");
    let b_data = std::fs::read(&b_path).unwrap();
    assert_eq!(b_data, pre, "app backup is not the exact pre-purge bytes");

    let listed = list_claude_json_app_backups().unwrap();
    assert!(
        listed.iter().any(|b| b.name == res.backup_name),
        "purge backup not listed"
    );

    // Full-file restore reproduces the pre-purge file exactly (auth included).
    restore_claude_json_app_backup(&res.backup_name).expect("restore");
    let restored = read_json_file(&h.home.join(".claude.json"));
    assert_eq!(restored, pre, "restore did not reproduce the pre-purge file exactly");
}

#[test]
fn purge_cas_race_surfaces_conflict() {
    let h = claude_json_home();
    let live = h.home.join("liveworkdir");
    std::fs::create_dir_all(&live).unwrap();
    let live = live.to_string_lossy().into_owned();
    write_claude_json(&h.home, &big_fixture_bytes(&live, None), 0o600);
    let json_path = h.home.join(".claude.json");

    // Each injected write differs (raceCounter) but keeps the targeted stale key,
    // so every attempt passes triage yet fails the CAS re-read.
    let counter = Arc::new(AtomicUsize::new(0));
    {
        let counter = counter.clone();
        let json_path = json_path.clone();
        let live = live.clone();
        let mut guard = super::CLAUDE_JSON_WRITE_RACE_HOOK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *guard = Some(Box::new(move || {
            let n = (counter.fetch_add(1, Ordering::SeqCst) + 1) as i64;
            std::fs::write(&json_path, big_fixture_bytes(&live, Some(n))).unwrap();
        }));
    }

    let err = purge_claude_json_projects(&["/zzz_stale_one".to_string()])
        .expect_err("expected a conflict error; purge may have clobbered a racing write");
    *super::CLAUDE_JSON_WRITE_RACE_HOOK
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;

    assert_eq!(err, super::ERR_CLAUDE_JSON_CONFLICT, "expected conflict error");
    assert_eq!(
        counter.load(Ordering::SeqCst),
        2,
        "hook fired wrong number of times, want 2 (initial + one retry)"
    );

    let final_bytes = read_json_file(&json_path);
    assert_eq!(
        final_bytes,
        big_fixture_bytes(&live, Some(2)),
        "purge clobbered the external write instead of surfacing a conflict"
    );
    let top = top_map(&final_bytes);
    let pm = projects_map(&top);
    assert!(pm.contains_key("/zzz_stale_one"), "stale key was purged from the external write");
}

#[test]
fn restore_rejects_bad_names() {
    let _h = claude_json_home();
    let bad = [
        "",
        ".",
        "..",
        "../../../etc/passwd.claude.json.bak",
        "foo/bar.claude.json.bak",
        "..1234.claude.json.bak",
        "1234.claude.json.bak/..",
        "notabackup.txt",
    ];
    for name in bad {
        assert!(
            restore_claude_json_app_backup(name).is_err(),
            "restore({name:?}) should be rejected"
        );
    }
}
