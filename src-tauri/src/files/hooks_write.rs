//! Ports `internal/files/hooks_write.go` — the enabled/disabled hooks view and
//! `toggle_hook`, which moves matcher-groups between the CLI's `settings.json`
//! "hooks" map and the app-owned `hooks-disabled.json` (which the CLI never
//! reads). Toggling never edits a command string, only moves the group between
//! the two files. Guards reproduced verbatim; the `"hooks changed, reload"`
//! sentinel is byte-identical (the frontend matches it literally).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::fsutil::{lock, write_file_mode};
use super::settings_write::mutate_settings_json;
use crate::config::root::claude_dir;

/// One hook matcher-group — either live in settings.json "hooks" (enabled) or
/// stashed in the app-owned hooks-disabled.json (disabled). Matcher and Commands
/// are carried verbatim. Mirrors `HookEntry`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEntry {
    pub event: String,
    pub matcher: String,
    pub commands: Vec<String>,
    pub fingerprint: String,
    pub index: i64,
}

/// The read model for the hooks manager panel. Mirrors `HookView`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookView {
    pub enabled: Vec<HookEntry>,
    pub disabled: Vec<HookEntry>,
}

/// Guards hooks-disabled.json. Kept separate from the settings.json mutex — the
/// two files are independent and must never share a lock. Poison-free acquire
/// via `fsutil::lock`. Mirrors `hooksWriteMu`.
static HOOKS_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Returns a stable, truncated sha256 hex digest over a hook matcher-group's
/// matcher + command strings, in order: the first 16 hex chars (= first 8 bytes)
/// of `sha256(matcher + "\0"-joined commands)`. Used by both `read_hooks` (to
/// label each entry) and `toggle_hook` (to verify a caller's snapshot still
/// matches the on-disk group before moving it). Mirrors `Fingerprint`.
pub fn fingerprint(group: &Value) -> String {
    let matcher = group.get("matcher").and_then(Value::as_str).unwrap_or("");
    let mut parts = vec![matcher.to_string()];
    parts.extend(group_commands(group));
    let sum = Sha256::digest(parts.join("\0").as_bytes());
    sum[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// Extracts each `hooks[i].command` string from a matcher-group, in order. A
/// malformed entry yields "" rather than panicking. Mirrors `groupCommands`.
fn group_commands(group: &Value) -> Vec<String> {
    let Some(raw_hooks) = group.get("hooks").and_then(Value::as_array) else {
        return Vec::new();
    };
    raw_hooks
        .iter()
        .map(|h| {
            h.get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        })
        .collect()
}

/// Builds the enabled/disabled view for the hooks manager panel. Enabled comes
/// from settings.json's "hooks" map; Disabled comes from the app-owned
/// hooks-disabled.json. If a fingerprint appears in both (a crash mid-toggle
/// left a duplicate), it is kept only in Enabled. Mirrors `ReadHooks`.
pub fn read_hooks(app_data_dir: &str) -> Result<HookView, String> {
    let settings_hooks = read_settings_hooks()?;
    let disabled_hooks = read_disabled_hooks(app_data_dir)?;

    let enabled = build_entries(&settings_hooks);
    let disabled = dedupe_against_enabled(build_entries(&disabled_hooks), &enabled);

    Ok(HookView { enabled, disabled })
}

fn dedupe_against_enabled(disabled: Vec<HookEntry>, enabled: &[HookEntry]) -> Vec<HookEntry> {
    let enabled_fingerprints: HashSet<&str> =
        enabled.iter().map(|e| e.fingerprint.as_str()).collect();
    disabled
        .into_iter()
        .filter(|d| !enabled_fingerprints.contains(d.fingerprint.as_str()))
        .collect()
}

/// Flattens an event->groups map into `HookEntry` values, sorted by event name
/// for deterministic output. Mirrors `buildEntries`.
fn build_entries(event_groups: &Map<String, Value>) -> Vec<HookEntry> {
    let mut events: Vec<&String> = event_groups.keys().collect();
    events.sort();

    let mut entries = Vec::new();
    for ev in events {
        let Some(groups) = event_groups.get(ev).and_then(Value::as_array) else {
            continue;
        };
        for (i, g) in groups.iter().enumerate() {
            if !g.is_object() {
                continue;
            }
            let matcher = g.get("matcher").and_then(Value::as_str).unwrap_or("");
            entries.push(HookEntry {
                event: ev.clone(),
                matcher: matcher.to_string(),
                commands: group_commands(g),
                fingerprint: fingerprint(g),
                index: i as i64,
            });
        }
    }
    entries
}

/// Reads settings.json fresh and returns its "hooks" map (event -> []group). A
/// missing file is treated as no hooks. Mirrors `readSettingsHooks`.
fn read_settings_hooks() -> Result<Map<String, Value>, String> {
    let cd = claude_dir()?;
    let path = cd.join("settings.json");
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(format!("files: read settings.json: {e}")),
    };
    let m: Map<String, Value> =
        serde_json::from_slice(&raw).map_err(|e| format!("files: parse settings.json: {e}"))?;
    let hooks = match m.get("hooks") {
        Some(Value::Object(o)) => o.clone(),
        _ => Map::new(),
    };
    Ok(hooks)
}

/// Reads hooks-disabled.json fresh (event -> []group, no wrapping key). A
/// missing file is treated as no disabled hooks. Mirrors `readDisabledHooks`.
fn read_disabled_hooks(app_data_dir: &str) -> Result<Map<String, Value>, String> {
    let raw = match fs::read(disabled_hooks_path(app_data_dir)) {
        Ok(raw) => raw,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(format!("files: read hooks-disabled.json: {e}")),
    };
    serde_json::from_slice(&raw).map_err(|e| format!("files: parse hooks-disabled.json: {e}"))
}

fn disabled_hooks_path(app_data_dir: &str) -> PathBuf {
    Path::new(app_data_dir).join("hooks-disabled.json")
}

/// Moves the matcher-group at (event, matcher_index) between settings.json's
/// "hooks" and the app-owned hooks-disabled.json. The caller must pass the
/// fingerprint it last observed for that entry; a mismatch aborts with no write.
/// Mirrors `ToggleHook`.
pub fn toggle_hook(
    app_data_dir: &str,
    event: &str,
    matcher_index: i64,
    fingerprint: &str,
    enable: bool,
) -> Result<(), String> {
    if enable {
        enable_hook(app_data_dir, event, matcher_index, fingerprint)
    } else {
        disable_hook(app_data_dir, event, matcher_index, fingerprint)
    }
}

/// Adds the group to hooks-disabled.json FIRST, then removes it from
/// settings.json. A crash between the two leaves a harmless duplicate (read_hooks
/// dedupes in favor of Enabled), never a lost hook. Mirrors `disableHook`.
fn disable_hook(
    app_data_dir: &str,
    event: &str,
    matcher_index: i64,
    fingerprint: &str,
) -> Result<(), String> {
    let settings_hooks = read_settings_hooks()?;
    let group = group_at(&settings_hooks, event, matcher_index, fingerprint)?;

    append_disabled_group(app_data_dir, event, &group)?;

    mutate_settings_json(|m| {
        pop_hook_group_by_fingerprint(m, event, fingerprint);
        Ok(())
    })
}

/// Adds the group back into settings.json FIRST, then removes it from
/// hooks-disabled.json. A crash between the two leaves a harmless duplicate,
/// never a lost hook. Mirrors `enableHook`.
fn enable_hook(
    app_data_dir: &str,
    event: &str,
    matcher_index: i64,
    fingerprint: &str,
) -> Result<(), String> {
    let disabled_hooks = read_disabled_hooks(app_data_dir)?;
    let group = group_at(&disabled_hooks, event, matcher_index, fingerprint)?;

    mutate_settings_json(move |m| {
        append_hook_group(m, event, group);
        Ok(())
    })?;

    remove_disabled_group(app_data_dir, event, fingerprint)
}

/// Bounds-checks `index` against `event_groups[event]` and verifies the group
/// found there still matches `fingerprint`. Never indexes unchecked. Mirrors
/// `groupAt`.
fn group_at(
    event_groups: &Map<String, Value>,
    event: &str,
    index: i64,
    fingerprint: &str,
) -> Result<Value, String> {
    let groups = event_groups
        .get(event)
        .and_then(Value::as_array)
        .map(|v| v.as_slice())
        .unwrap_or(&[]);
    if index < 0 || index as usize >= groups.len() {
        return Err(format!(
            "files: hook index {index} out of range for event {event:?}"
        ));
    }
    let group = &groups[index as usize];
    if !group.is_object() {
        return Err(format!(
            "files: hook group at {event:?}[{index}] is not an object"
        ));
    }
    if self::fingerprint(group) != fingerprint {
        return Err("hooks changed, reload".to_string());
    }
    Ok(group.clone())
}

/// Removes the group in `m["hooks"][event]` whose content fingerprint matches,
/// wherever it currently sits. Locating by fingerprint (not the caller's index)
/// is robust to a concurrent CLI rewrite reordering the slice. A missing match
/// is a silent no-op. Mirrors `popHookGroupByFingerprint`.
fn pop_hook_group_by_fingerprint(m: &mut Map<String, Value>, event: &str, fingerprint: &str) {
    let Some(hooks) = m.get_mut("hooks").and_then(Value::as_object_mut) else {
        return;
    };
    let Some(groups) = hooks.get_mut(event).and_then(Value::as_array_mut) else {
        return;
    };
    if let Some(pos) = groups.iter().position(|g| self::fingerprint(g) == fingerprint) {
        groups.remove(pos);
    }
}

/// Appends `group` to `m["hooks"][event]`, creating the "hooks" map or the
/// event's slice if either is missing. Mirrors `appendHookGroup`.
fn append_hook_group(m: &mut Map<String, Value>, event: &str, group: Value) {
    let hooks = m
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks.is_object() {
        *hooks = Value::Object(Map::new());
    }
    let hooks_obj = hooks.as_object_mut().expect("hooks is an object");

    let groups = hooks_obj
        .entry(event)
        .or_insert_with(|| Value::Array(Vec::new()));
    if !groups.is_array() {
        *groups = Value::Array(Vec::new());
    }
    groups.as_array_mut().expect("groups is an array").push(group);
}

/// The sole read-modify-atomic-write cycle for hooks-disabled.json, guarded by
/// `HOOKS_WRITE_MU`. Mirrors `mutate_settings_json`'s read-fresh + .bak +
/// temp-rename idiom for its own file (.bak at 0o644). Mirrors
/// `mutateDisabledHooks`.
fn mutate_disabled_hooks<F>(app_data_dir: &str, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut Map<String, Value>),
{
    let _guard = lock(&HOOKS_WRITE_MU);

    fs::create_dir_all(app_data_dir).map_err(|e| format!("files: mkdir app data dir: {e}"))?;

    let path = disabled_hooks_path(app_data_dir);
    let read_result = fs::read(&path);
    if let Err(e) = &read_result {
        if e.kind() != io::ErrorKind::NotFound {
            return Err(format!("files: read hooks-disabled.json: {e}"));
        }
    }

    let mut m = Map::new();
    if let Ok(raw) = &read_result {
        m = serde_json::from_slice(raw)
            .map_err(|e| format!("files: parse hooks-disabled.json: {e}"))?;
        write_file_mode(&with_suffix(&path, ".bak"), raw, 0o644)
            .map_err(|e| format!("files: write hooks-disabled.json.bak: {e}"))?;
    }

    mutate(&mut m);

    let data = crate::files::json_util::to_go_json_pretty(&Value::Object(m))
        .map_err(|e| format!("files: marshal hooks-disabled.json: {e}"))?;
    atomic_write_file(&path, &data)
}

fn append_disabled_group(app_data_dir: &str, event: &str, group: &Value) -> Result<(), String> {
    mutate_disabled_hooks(app_data_dir, |m| {
        let groups = m.entry(event).or_insert_with(|| Value::Array(Vec::new()));
        if !groups.is_array() {
            *groups = Value::Array(Vec::new());
        }
        groups
            .as_array_mut()
            .expect("groups is an array")
            .push(group.clone());
    })
}

/// Appends imported hook matcher-groups straight into hooks-disabled.json,
/// leaving them DISABLED — config import routes untrusted hooks here because
/// writing an untrusted hook into settings.json even transiently would arm it on
/// the next `claude` run. Append is per-event and fingerprint-deduped. Called by
/// W14 config import. Mirrors `AddDisabledHookGroups`.
pub fn add_disabled_hook_groups(
    app_data_dir: &str,
    groups: &HashMap<String, Vec<Value>>,
) -> Result<(), String> {
    if groups.is_empty() {
        return Ok(());
    }
    mutate_disabled_hooks(app_data_dir, |m| {
        for (event, incoming) in groups {
            let mut existing = match m.get(event) {
                Some(Value::Array(a)) => a.clone(),
                _ => Vec::new(),
            };
            let mut seen: HashSet<String> = existing.iter().map(fingerprint).collect();
            for g in incoming {
                let fp = fingerprint(g);
                if seen.contains(&fp) {
                    continue;
                }
                seen.insert(fp);
                existing.push(g.clone());
            }
            m.insert(event.clone(), Value::Array(existing));
        }
    })
}

/// Removes the hooks-disabled.json[event] group whose content fingerprint
/// matches, wherever it sits. A missing match is a silent no-op. Mirrors
/// `removeDisabledGroup`.
fn remove_disabled_group(
    app_data_dir: &str,
    event: &str,
    fingerprint: &str,
) -> Result<(), String> {
    mutate_disabled_hooks(app_data_dir, |m| {
        let Some(groups) = m.get_mut(event).and_then(Value::as_array_mut) else {
            return;
        };
        if let Some(pos) = groups.iter().position(|g| self::fingerprint(g) == fingerprint) {
            groups.remove(pos);
        }
    })
}

/// Writes `data` to `path` via temp+rename (mode 0o644). Local so error messages
/// name the right file. Mirrors `atomicWriteFile`.
fn atomic_write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp_path = with_suffix(path, ".tmp");
    let base = base_name(&tmp_path);
    write_file_mode(&tmp_path, data, 0o644).map_err(|e| format!("files: write {base}: {e}"))?;
    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("files: rename {base}: {e}"));
    }
    Ok(())
}

/// Byte-appends `suffix` to `path` — mirrors Go's `path + ".bak"` / `+ ".tmp"`.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(suffix);
    PathBuf::from(os)
}

/// Mirrors `filepath.Base(path)` for error messages.
fn base_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "hooks_write_tests.rs"]
mod hooks_write_tests;
