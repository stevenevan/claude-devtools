//! Test-only support shared by the claudejson read/write tests. Ports the Go
//! `claudeJSONHome` / `writeClaudeJSON` / fixture builders. Every test runs
//! against a fresh temp `HOME` (never the real `~/.claude.json`) and holds a
//! process-wide env lock so the parallel test runner never races on `HOME` /
//! `CLAUDE_DEVTOOLS_DIR`.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::MutexGuard;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;
use serde_json::value::RawValue;

pub const FIXTURE_EMAIL: &str = "user@example.com";
pub const FIXTURE_TOKEN: &str = "sk-live-secrettoken";

use crate::files::TEST_ENV_LOCK;

/// Owns a temp `HOME` + the env lock for the duration of a test. Drop restores
/// the previous env and deletes the temp tree.
pub struct TestHome {
    pub home: PathBuf,
    _guard: MutexGuard<'static, ()>,
    old_home: Option<OsString>,
    old_appdata: Option<OsString>,
}

impl Drop for TestHome {
    fn drop(&mut self) {
        restore_env("HOME", &self.old_home);
        restore_env("CLAUDE_DEVTOOLS_DIR", &self.old_appdata);
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn restore_env(key: &str, val: &Option<OsString>) {
    match val {
        Some(v) => std::env::set_var(key, v),
        None => std::env::remove_var(key),
    }
}

/// Sets `HOME` to a fresh temp dir, creates `~/.claude/{projects,backups}`, and
/// clears `CLAUDE_DEVTOOLS_DIR` so the app data dir falls back under the temp
/// home. Serializes via the env lock. Mirrors Go `claudeJSONHome`.
pub fn claude_json_home() -> TestHome {
    let guard = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let old_home = std::env::var_os("HOME");
    let old_appdata = std::env::var_os("CLAUDE_DEVTOOLS_DIR");

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let base = std::env::temp_dir().join(format!("cdj-test-{}-{nanos}-{n}", std::process::id()));
    std::fs::create_dir_all(base.join(".claude").join("projects")).unwrap();
    std::fs::create_dir_all(base.join(".claude").join("backups")).unwrap();
    // Canonicalize so on-disk stat paths match (macOS /var → /private/var).
    let home = std::fs::canonicalize(&base).unwrap();

    std::env::set_var("HOME", &home);
    std::env::remove_var("CLAUDE_DEVTOOLS_DIR");

    TestHome {
        home,
        _guard: guard,
        old_home,
        old_appdata,
    }
}

/// Writes `~/.claude.json` with the given bytes and permission mode.
pub fn write_claude_json(home: &Path, bytes: &[u8], mode: u32) {
    let path = home.join(".claude.json");
    std::fs::write(&path, bytes).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
}

fn raw(s: String) -> Box<RawValue> {
    RawValue::from_string(s).unwrap()
}

/// Census fixture: a live-on-disk project plus stale / unverifiable /
/// cross-referenced-live entries, a secret-shaped value under a benign key, and a
/// credential-shaped key. Emitted compactly with a big-int-safe raw path.
pub fn fixture_content_bytes(live_on_disk: &str) -> Vec<u8> {
    let mut m: BTreeMap<String, Box<RawValue>> = BTreeMap::new();
    m.insert("numStartups".into(), raw("2543".into()));
    m.insert("theme".into(), raw("\"dark\"".into()));
    m.insert("helper".into(), raw(serde_json::to_string(FIXTURE_TOKEN).unwrap()));
    m.insert(
        "oauthAccount".into(),
        raw(serde_json::to_string(&json!({"emailAddress": FIXTURE_EMAIL, "accountUuid": "uuid-1234"})).unwrap()),
    );
    m.insert("hasSeenTasksHint".into(), raw("true".into()));
    m.insert("cachedChangelog".into(), raw("\"v1.2.3 notes\"".into()));

    let mut projects: BTreeMap<String, Box<RawValue>> = BTreeMap::new();
    projects.insert(
        live_on_disk.into(),
        raw(serde_json::to_string(&json!({"allowedTools": ["Bash"], "hasTrustDialogAccepted": true})).unwrap()),
    );
    projects.insert(
        "/zzz_stale_project_dir".into(),
        raw(serde_json::to_string(&json!({"allowedTools": []})).unwrap()),
    );
    projects.insert(
        "/zzz-unverifiable-dir".into(),
        raw(serde_json::to_string(&json!({"history": []})).unwrap()),
    );
    projects.insert(
        "/zzz/livehist/projectx".into(),
        raw(serde_json::to_string(&json!({"allowedTools": []})).unwrap()),
    );
    m.insert("projects".into(), raw(serde_json::to_string(&projects).unwrap()));

    serde_json::to_vec(&m).unwrap()
}

/// Real-shaped write fixture: 90+ top-level keys, `oauthAccount`
/// (credential-shaped), a large-integer field (proves the raw path preserves
/// number bytes losslessly), and a projects map with several stale entries plus a
/// live and an unverifiable one. `race_counter`, when set, adds a `raceCounter`
/// key (mirrors the Go CAS-race injection).
pub fn big_fixture_bytes(live_on_disk: &str, race_counter: Option<i64>) -> Vec<u8> {
    let mut m: BTreeMap<String, Box<RawValue>> = BTreeMap::new();
    m.insert("numStartups".into(), raw("2543".into()));
    m.insert("theme".into(), raw("\"dark\"".into()));
    m.insert("helper".into(), raw(serde_json::to_string(FIXTURE_TOKEN).unwrap()));
    m.insert("bigIntField".into(), raw("123456789012345678901234567890".into()));
    m.insert(
        "oauthAccount".into(),
        raw(serde_json::to_string(&json!({
            "emailAddress": FIXTURE_EMAIL,
            "accountUuid": "uuid-1234",
            "accessToken": "sk-secret-access"
        }))
        .unwrap()),
    );
    m.insert("hasSeenTasksHint".into(), raw("true".into()));
    m.insert("cachedChangelog".into(), raw("\"v1.2.3 notes\"".into()));
    if let Some(n) = race_counter {
        m.insert("raceCounter".into(), raw(n.to_string()));
    }

    let mut projects: BTreeMap<String, Box<RawValue>> = BTreeMap::new();
    projects.insert(
        live_on_disk.into(),
        raw(serde_json::to_string(&json!({"allowedTools": ["Bash"], "hasTrustDialogAccepted": true})).unwrap()),
    );
    projects.insert(
        "/zzz_stale_one".into(),
        raw(serde_json::to_string(&json!({"allowedTools": [], "history": ["a", "b"]})).unwrap()),
    );
    projects.insert(
        "/zzz_stale_two".into(),
        raw(serde_json::to_string(&json!({"allowedTools": ["Read"]})).unwrap()),
    );
    projects.insert(
        "/zzz_stale_three".into(),
        raw(serde_json::to_string(&json!({"lastCost": 1.25})).unwrap()),
    );
    projects.insert(
        "/zzz-unverifiable-dir".into(),
        raw(serde_json::to_string(&json!({"history": []})).unwrap()),
    );
    m.insert("projects".into(), raw(serde_json::to_string(&projects).unwrap()));

    for i in 0..90 {
        m.insert(
            format!("pad_{i:02}"),
            raw(serde_json::to_string(&format!("value-{i}")).unwrap()),
        );
    }

    // Render in the SAME 2-space pretty format the purge writes, so removing
    // project entries strictly shrinks the file (mirrors Go's writeClaudeJSONPretty).
    crate::files::claudejson_write::pretty_indent(&serde_json::to_vec(&m).unwrap())
}
