//! Ports `internal/files/settings_write.go` — the SINGLE writer of
//! `~/.claude/settings.json`. Every config editor routes its write through the
//! one `SETTINGS_WRITE_MU` mutex, reads the file fresh under the lock (never
//! trusts a frontend snapshot, so it is safe against the CLI rewriting
//! concurrently), backs the pre-image up to `.bak` BEFORE writing, and lands the
//! new content via temp+rename. Guards reproduced verbatim.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::fsutil::{lock, write_file_mode};
use crate::config::root::claude_dir;

/// The frontend-editable subset of `~/.claude/settings.json`. Mirrors
/// `SettingsPatch`. Missing fields default to empty (Go's nil map/slice) so a
/// partial patch from the frontend is valid.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub env: HashMap<String, String>,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub ask: Vec<String>,
}

/// The one mutex every settings.json writer shares. Poison-free acquire (Go
/// mutexes never poison, and no writer holds an invariant across a panic).
static SETTINGS_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Reads `~/.claude/settings.json` as arbitrary JSON. Missing file → `{}`.
/// Mirrors `pathutil.go:ReadGlobalSettings` (claudeDir-hardcoded).
pub fn read_global_settings() -> Result<Value, String> {
    let settings_file = claude_dir()?.join("settings.json");
    if !settings_file.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let raw = fs::read(&settings_file).map_err(|e| e.to_string())?;
    serde_json::from_slice(&raw).map_err(|e| e.to_string())
}

const ENV_KEY_PATTERN_STR: &str = r"^[A-Za-z_][A-Za-z0-9_]*$";

/// Matches valid POSIX environment variable names. Mirrors `envKeyPattern`.
static ENV_KEY_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(ENV_KEY_PATTERN_STR).unwrap());

/// The SINGLE writer of `~/.claude/settings.json`. Locks `SETTINGS_WRITE_MU`,
/// reads the file fresh, and calls `mutate` on the parsed object. CONTRACT:
/// settings.json.bak is written from the pre-mutation bytes BEFORE `mutate` runs
/// — a caller needing a no-.bak-on-invalid-input guarantee must validate BEFORE
/// calling (as `update_global_settings` does with env keys). A corrupt current
/// file returns an error and `mutate` never runs (use `replace_settings_json` to
/// overwrite a corrupt current file). Mirrors `MutateSettingsJSON` VERBATIM.
pub fn mutate_settings_json<F>(mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut Map<String, Value>) -> Result<(), String>,
{
    let _guard = lock(&SETTINGS_WRITE_MU);

    let cd = claude_dir()?;
    let settings_file = cd.join("settings.json");

    let read_result = fs::read(&settings_file);
    if let Err(e) = &read_result {
        if e.kind() != io::ErrorKind::NotFound {
            return Err(format!("files: read settings.json: {e}"));
        }
    }

    // Mirrors Go's `fileExists` gate: parse + back up only when the file existed.
    let mut m = Map::new();
    if let Ok(raw) = &read_result {
        m = serde_json::from_slice(raw)
            .map_err(|e| format!("files: parse settings.json: {e}"))?;
        write_file_mode(&with_suffix(&settings_file, ".bak"), raw, 0o644)
            .map_err(|e| format!("files: write settings.json.bak: {e}"))?;
    }

    mutate(&mut m)?;

    fs::create_dir_all(&cd).map_err(|e| format!("files: mkdir .claude: {e}"))?;
    let data = crate::files::json_util::to_go_json_pretty(&Value::Object(m))
        .map_err(|e| format!("files: marshal settings.json: {e}"))?;
    atomic_write_settings(&settings_file, &data)
}

/// Overwrites settings.json with `new_raw` (validated JSON object), backing up
/// the CURRENT bytes to .bak AS-IS first — even if the current file is corrupt,
/// so a bad state stays recoverable. Shares `SETTINGS_WRITE_MU`. Mirrors
/// `ReplaceSettingsJSON` VERBATIM.
pub fn replace_settings_json(new_raw: &[u8]) -> Result<(), String> {
    serde_json::from_slice::<Map<String, Value>>(new_raw)
        .map_err(|e| format!("files: refusing to write invalid settings JSON: {e}"))?;

    let _guard = lock(&SETTINGS_WRITE_MU);

    let cd = claude_dir()?;
    let settings_file = cd.join("settings.json");

    if let Ok(cur) = fs::read(&settings_file) {
        write_file_mode(&with_suffix(&settings_file, ".bak"), &cur, 0o644)
            .map_err(|e| format!("files: write settings.json.bak: {e}"))?;
    }
    fs::create_dir_all(&cd).map_err(|e| format!("files: mkdir .claude: {e}"))?;
    atomic_write_settings(&settings_file, new_raw)
}

/// Writes `data` to `settings_file` via temp+rename (mode 0o644). Mirrors
/// `atomicWriteSettings`.
fn atomic_write_settings(settings_file: &Path, data: &[u8]) -> Result<(), String> {
    let tmp_path = with_suffix(settings_file, ".tmp");
    write_file_mode(&tmp_path, data, 0o644)
        .map_err(|e| format!("files: write settings.json.tmp: {e}"))?;
    if let Err(e) = fs::rename(&tmp_path, settings_file) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("files: rename settings.json.tmp: {e}"));
    }
    Ok(())
}

/// Replaces only "env" and "permissions.{allow,deny,ask}", preserving every
/// other key. Env-key validation stays BEFORE the mutator so an invalid key
/// never writes .bak. Mirrors `UpdateGlobalSettings`.
pub fn update_global_settings(patch: SettingsPatch) -> Result<(), String> {
    for k in patch.env.keys() {
        if !ENV_KEY_PATTERN.is_match(k) {
            return Err(format!(
                "files: invalid env key {k:?}: must match {ENV_KEY_PATTERN_STR}"
            ));
        }
    }
    mutate_settings_json(move |m| {
        m.insert("env".to_string(), to_json(&patch.env)?);

        let mut perms = match m.get("permissions") {
            Some(Value::Object(o)) => o.clone(),
            _ => Map::new(),
        };
        perms.insert("allow".to_string(), to_json(&patch.allow)?);
        perms.insert("deny".to_string(), to_json(&patch.deny)?);
        perms.insert("ask".to_string(), to_json(&patch.ask)?);
        m.insert("permissions".to_string(), Value::Object(perms));
        Ok(())
    })
}

fn to_json<T: Serialize>(v: &T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| format!("files: marshal settings.json: {e}"))
}

/// Byte-appends `suffix` to `path` — mirrors Go's `settingsFile + ".bak"`.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os: OsString = path.as_os_str().to_os_string();
    os.push(suffix);
    PathBuf::from(os)
}

/// Shared test scaffolding for every settings.json test module. Redirects
/// `$HOME` to a fresh temp dir under a process-wide lock so parallel Rust tests
/// never clobber each other's home (Go runs these sequentially via `t.Setenv`).
/// Never touches the real `~/.claude`.
#[cfg(test)]
pub(crate) mod test_home {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::MutexGuard;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::files::TEST_ENV_LOCK as ENV_LOCK;

    /// Holds the env lock and restores the previous `$HOME` on drop.
    pub(crate) struct HomeGuard {
        _lock: MutexGuard<'static, ()>,
        prev: Option<String>,
        pub home: PathBuf,
        pub claude_dir: PathBuf,
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    /// Redirects `$HOME` to a fresh temp dir; the returned guard restores it.
    pub(crate) fn redirect_home() -> HomeGuard {
        let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var("HOME").ok();
        let home = unique_temp_dir("settings-test");
        std::fs::create_dir_all(&home).unwrap();
        std::env::set_var("HOME", &home);
        let claude_dir = home.join(".claude");
        HomeGuard {
            _lock: lock,
            prev,
            home,
            claude_dir,
        }
    }

    pub(crate) fn unique_temp_dir(prefix: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{}-{nanos}-{n}", std::process::id()))
    }

    /// Mirrors the tests' `writeSettingsFile`: mkdir -p then write 0o644.
    pub(crate) fn write_settings_file(dir: &Path, path: &Path, content: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(path, content).unwrap();
    }
}

#[cfg(test)]
#[path = "settings_write_tests.rs"]
mod settings_write_tests;
