//! Ports `internal/files/hooks_write_test.go`. Uses the shared
//! `settings_write::test_home` scaffolding (process-wide env lock + temp `$HOME`)
//! so settings.json lives under a fresh temp home — NEVER the real `~/.claude`.
//! `app_data_dir` is a separate temp dir passed explicitly.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{add_disabled_hook_groups, fingerprint, read_hooks, toggle_hook, HookEntry};
use crate::files::settings_write::test_home::{
    redirect_home, unique_temp_dir, write_settings_file, HomeGuard,
};

// 2 events; PreToolUse has 2 groups. The Bash group carries an unknown field
// ("description") and a command containing "2>&1" and "&&". The top-level
// "customKey"/"theme" are unknown keys toggling must never touch.
const HOOKS_SEED: &str = r#"{
    "hooks": {
        "PreToolUse": [
            {
                "matcher": "Bash",
                "description": "logs bash commands before execution",
                "hooks": [
                    { "type": "command", "command": "echo start && ./run.sh 2>&1 | tee -a log.txt" }
                ]
            },
            {
                "matcher": "Write",
                "hooks": [
                    { "type": "command", "command": "echo writing" }
                ]
            }
        ],
        "SessionStart": [
            {
                "matcher": "*",
                "hooks": [
                    { "type": "command", "command": "echo session start" }
                ]
            }
        ]
    },
    "customKey": { "nested": "value", "count": 3 },
    "theme": "dark"
}"#;

fn seed_hooks_settings() -> (HomeGuard, PathBuf) {
    let guard = redirect_home();
    let settings_file = guard.claude_dir.join("settings.json");
    write_settings_file(&guard.claude_dir, &settings_file, HOOKS_SEED);
    (guard, settings_file)
}

fn read_json_value(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).expect("read")).expect("parse")
}

fn find_entry<'a>(entries: &'a [HookEntry], event: &str, matcher: &str) -> &'a HookEntry {
    entries
        .iter()
        .find(|e| e.event == event && e.matcher == matcher)
        .unwrap_or_else(|| panic!("entry not found: event={event} matcher={matcher}"))
}

fn group_by_matcher<'a>(groups: &'a [Value], matcher: &str) -> &'a Value {
    groups
        .iter()
        .find(|g| g.get("matcher").and_then(Value::as_str) == Some(matcher))
        .unwrap_or_else(|| panic!("group with matcher {matcher} not found"))
}

#[test]
fn toggle_disable_enable_round_trip_preserves_commands_and_unknown_fields() {
    let (_guard, settings_file) = seed_hooks_settings();
    let app_data_dir = unique_temp_dir("hooks-appdata");
    let app = app_data_dir.to_str().unwrap();

    let before = read_hooks(app).expect("read hooks");
    let target = find_entry(&before.enabled, "PreToolUse", "Bash");
    toggle_hook(app, &target.event, target.index, &target.fingerprint, false).expect("disable");

    let after_disable = read_hooks(app).expect("read after disable");
    let disabled_entry = find_entry(&after_disable.disabled, "PreToolUse", "Bash");
    toggle_hook(
        app,
        &disabled_entry.event,
        disabled_entry.index,
        &disabled_entry.fingerprint,
        true,
    )
    .expect("enable");

    let settings = read_json_value(&settings_file);
    let pre_tool_use = settings["hooks"]["PreToolUse"].as_array().unwrap();
    let restored = group_by_matcher(pre_tool_use, "Bash");

    assert_eq!(
        restored["description"].as_str(),
        Some("logs bash commands before execution"),
        "unknown group field not preserved"
    );
    assert_eq!(
        restored["hooks"][0]["command"].as_str(),
        Some("echo start && ./run.sh 2>&1 | tee -a log.txt"),
        "command not preserved"
    );

    let custom = &settings["customKey"];
    assert_eq!(custom["nested"].as_str(), Some("value"));
    assert_eq!(custom["count"].as_i64(), Some(3));
}

#[test]
fn toggle_disable_removes_from_settings_adds_to_disabled() {
    let (_guard, settings_file) = seed_hooks_settings();
    let app_data_dir = unique_temp_dir("hooks-appdata");
    let app = app_data_dir.to_str().unwrap();

    let before = read_hooks(app).expect("read hooks");
    let target = find_entry(&before.enabled, "PreToolUse", "Bash");
    toggle_hook(app, &target.event, target.index, &target.fingerprint, false).expect("disable");

    let settings = read_json_value(&settings_file);
    let pre_tool_use = settings["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(pre_tool_use.len(), 1, "PreToolUse length");
    assert_ne!(
        pre_tool_use[0]["matcher"].as_str(),
        Some("Bash"),
        "Bash group still present in settings.json after disable"
    );

    let disabled = read_json_value(&app_data_dir.join("hooks-disabled.json"));
    let disabled_pre = disabled["PreToolUse"].as_array().expect("disabled PreToolUse");
    assert_eq!(disabled_pre.len(), 1);
    assert_eq!(disabled_pre[0]["matcher"].as_str(), Some("Bash"));
}

#[test]
fn toggle_enable_removes_from_disabled_adds_to_settings() {
    let (_guard, settings_file) = seed_hooks_settings();
    let app_data_dir = unique_temp_dir("hooks-appdata");
    let app = app_data_dir.to_str().unwrap();

    let before = read_hooks(app).expect("read hooks");
    let target = find_entry(&before.enabled, "PreToolUse", "Bash");
    toggle_hook(app, &target.event, target.index, &target.fingerprint, false).expect("disable");

    let after_disable = read_hooks(app).expect("read after disable");
    let disabled_entry = find_entry(&after_disable.disabled, "PreToolUse", "Bash");
    toggle_hook(
        app,
        &disabled_entry.event,
        disabled_entry.index,
        &disabled_entry.fingerprint,
        true,
    )
    .expect("enable");

    let settings = read_json_value(&settings_file);
    let pre_tool_use = settings["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(pre_tool_use.len(), 2, "PreToolUse length");
    group_by_matcher(pre_tool_use, "Bash"); // panics if absent

    let disabled = read_json_value(&app_data_dir.join("hooks-disabled.json"));
    if let Some(remaining) = disabled.get("PreToolUse").and_then(Value::as_array) {
        assert_eq!(remaining.len(), 0, "hooks-disabled.json PreToolUse not emptied");
    }
}

#[test]
fn toggle_unrelated_settings_keys_preserved() {
    let (_guard, settings_file) = seed_hooks_settings();
    let app_data_dir = unique_temp_dir("hooks-appdata");
    let app = app_data_dir.to_str().unwrap();

    let before = read_hooks(app).expect("read hooks");
    let target = find_entry(&before.enabled, "PreToolUse", "Write");
    toggle_hook(app, &target.event, target.index, &target.fingerprint, false).expect("disable");

    let settings = read_json_value(&settings_file);
    assert_eq!(settings["theme"].as_str(), Some("dark"), "theme not preserved");
    let custom = &settings["customKey"];
    assert_eq!(custom["nested"].as_str(), Some("value"));
    assert_eq!(custom["count"].as_i64(), Some(3));

    let session_start = settings["hooks"]["SessionStart"].as_array().unwrap();
    assert_eq!(session_start.len(), 1, "SessionStart unexpectedly changed");
    assert_eq!(
        session_start[0]["hooks"][0]["command"].as_str(),
        Some("echo session start"),
        "SessionStart command changed"
    );
}

#[test]
fn toggle_fingerprint_mismatch_errors_no_write() {
    let (_guard, settings_file) = seed_hooks_settings();
    let app_data_dir = unique_temp_dir("hooks-appdata");
    let app = app_data_dir.to_str().unwrap();

    let before_raw = fs::read(&settings_file).expect("read settings.json");

    let err = toggle_hook(app, "PreToolUse", 0, "deadbeefdeadbeef", false)
        .expect_err("expected fingerprint mismatch");
    assert_eq!(err, "hooks changed, reload");

    let after_raw = fs::read(&settings_file).expect("read settings.json after");
    assert_eq!(
        before_raw, after_raw,
        "settings.json changed despite fingerprint mismatch"
    );
    assert!(
        !app_data_dir.join("hooks-disabled.json").exists(),
        "hooks-disabled.json should not exist"
    );
}

#[test]
fn toggle_out_of_range_index_errors_no_panic() {
    let (_guard, settings_file) = seed_hooks_settings();
    let app_data_dir = unique_temp_dir("hooks-appdata");
    let app = app_data_dir.to_str().unwrap();

    let before_raw = fs::read(&settings_file).expect("read settings.json");

    assert!(
        toggle_hook(app, "PreToolUse", 99, "irrelevant", false).is_err(),
        "out-of-range index"
    );
    assert!(
        toggle_hook(app, "PreToolUse", -1, "irrelevant", false).is_err(),
        "negative index"
    );
    // Enable side, sourced from a hooks-disabled.json that doesn't exist yet.
    assert!(
        toggle_hook(app, "PreToolUse", 0, "irrelevant", true).is_err(),
        "out-of-range index on enable (no disabled file)"
    );

    let after_raw = fs::read(&settings_file).expect("read settings.json after");
    assert_eq!(
        before_raw, after_raw,
        "settings.json changed despite out-of-range index"
    );
}

// Not in the Go test file: covers `add_disabled_hook_groups` (W14 config import),
// which appends untrusted groups straight to hooks-disabled.json, deduped.
#[test]
fn add_disabled_hook_groups_appends_and_dedupes() {
    let _guard = redirect_home();
    let app_data_dir = unique_temp_dir("hooks-add-disabled");
    let app = app_data_dir.to_str().unwrap();

    let group = serde_json::json!({
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "echo hi" }]
    });
    let mut groups: HashMap<String, Vec<Value>> = HashMap::new();
    groups.insert("PreToolUse".to_string(), vec![group.clone(), group.clone()]);

    add_disabled_hook_groups(app, &groups).expect("add");
    add_disabled_hook_groups(app, &groups).expect("add again");

    let disabled = read_json_value(&app_data_dir.join("hooks-disabled.json"));
    let arr = disabled["PreToolUse"].as_array().unwrap();
    assert_eq!(arr.len(), 1, "fingerprint-deduped to a single group");
    assert_eq!(fingerprint(&arr[0]), fingerprint(&group));
    // Untrusted import must never touch settings.json.
    assert!(!redirect_home_settings_exists(), "settings.json must not be written");
}

fn redirect_home_settings_exists() -> bool {
    crate::config::root::claude_dir()
        .map(|cd| cd.join("settings.json").exists())
        .unwrap_or(false)
}
