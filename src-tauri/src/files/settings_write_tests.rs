//! Ports `settings_write_test.go` — the single-writer safety cases. Every test
//! redirects `$HOME` to a temp dir (never the real `~/.claude`).

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;

use super::test_home::{redirect_home, write_settings_file, HomeGuard};
use super::{update_global_settings, SettingsPatch};

/// Sets up a redirected HOME and returns the paths UpdateGlobalSettings reads.
fn settings_paths() -> (HomeGuard, PathBuf, PathBuf, PathBuf, PathBuf) {
    let h = redirect_home();
    let dir = h.claude_dir.clone();
    let settings_file = dir.join("settings.json");
    let bak_file = dir.join("settings.json.bak");
    let tmp_file = dir.join("settings.json.tmp");
    (h, dir, settings_file, bak_file, tmp_file)
}

fn read_json(path: &PathBuf) -> Value {
    let raw = std::fs::read_to_string(path).expect("read settings.json");
    serde_json::from_str(&raw).expect("parse settings.json")
}

fn env_patch(pairs: &[(&str, &str)]) -> SettingsPatch {
    let env: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    SettingsPatch {
        env,
        ..Default::default()
    }
}

#[test]
fn round_trip_preserves_unrelated_keys() {
    let (h, dir, settings_file, _, _) = settings_paths();
    let seed = r#"{
        "$schema": "https://example.com/schema.json",
        "theme": "dark",
        "permissions": {
            "defaultMode": "acceptEdits",
            "allow": ["Bash(ls:*)"]
        }
    }"#;
    write_settings_file(&dir, &settings_file, seed);

    update_global_settings(SettingsPatch {
        env: HashMap::from([("FOO".to_string(), "bar".to_string())]),
        allow: vec!["Bash(rm:*)".to_string()],
        ..Default::default()
    })
    .expect("update_global_settings");

    let got = read_json(&settings_file);
    assert_eq!(got["$schema"], "https://example.com/schema.json");
    assert_eq!(got["theme"], "dark");
    assert_eq!(got["env"]["FOO"], "bar");
    assert_eq!(got["permissions"]["defaultMode"], "acceptEdits");
    assert_eq!(
        got["permissions"]["allow"],
        Value::Array(vec![Value::from("Bash(rm:*)")])
    );
    drop(h);
}

#[test]
fn backup_holds_old_content() {
    let (h, dir, settings_file, bak_file, _) = settings_paths();
    let seed = r#"{"theme": "dark"}"#;
    write_settings_file(&dir, &settings_file, seed);

    update_global_settings(env_patch(&[("A", "1")])).expect("update_global_settings");

    let bak = std::fs::read_to_string(&bak_file).expect("read .bak");
    assert_eq!(bak, seed);
    drop(h);
}

#[test]
fn missing_file_creates_valid_file_no_backup() {
    let (h, _, settings_file, bak_file, _) = settings_paths();

    update_global_settings(env_patch(&[("A", "1")])).expect("update_global_settings");

    let _ = read_json(&settings_file); // must parse as JSON
    assert!(!bak_file.exists(), "expected no .bak for missing-file case");
    drop(h);
}

#[test]
fn corrupt_file_errors_and_leaves_file_unchanged() {
    let (h, dir, settings_file, _, _) = settings_paths();
    let corrupt = "{not valid json";
    write_settings_file(&dir, &settings_file, corrupt);

    let err = update_global_settings(env_patch(&[("A", "1")]));
    assert!(err.is_err(), "expected error for corrupt settings.json");

    let raw = std::fs::read_to_string(&settings_file).expect("settings.json disappeared");
    assert_eq!(raw, corrupt);
    drop(h);
}

#[test]
fn invalid_env_key_errors_and_leaves_file_unchanged() {
    let (h, dir, settings_file, bak_file, _) = settings_paths();
    let seed = r#"{"theme": "dark"}"#;
    write_settings_file(&dir, &settings_file, seed);

    let err = update_global_settings(env_patch(&[("BAD KEY=x", "1")]));
    assert!(err.is_err(), "expected error for invalid env key");

    let raw = std::fs::read_to_string(&settings_file).expect("settings.json disappeared");
    assert_eq!(raw, seed);
    assert!(
        !bak_file.exists(),
        "expected no .bak for invalid-env-key case"
    );
    drop(h);
}

#[test]
fn no_tmp_file_left_after_success() {
    let (h, _, _, _, tmp_file) = settings_paths();

    update_global_settings(env_patch(&[("A", "1")])).expect("update_global_settings");

    assert!(!tmp_file.exists(), "expected no .tmp file left behind");
    drop(h);
}

#[test]
fn survives_external_edit_between_updates() {
    let (h, dir, settings_file, _, _) = settings_paths();
    let seed = r#"{"theme": "dark"}"#;
    write_settings_file(&dir, &settings_file, seed);

    update_global_settings(env_patch(&[("A", "1")])).expect("first update");

    // Simulate the CLI editing settings.json between the two app saves.
    let mut m = read_json(&settings_file);
    m.as_object_mut()
        .unwrap()
        .insert("externallyAdded".to_string(), Value::from("from-cli"));
    std::fs::write(&settings_file, serde_json::to_vec(&m).unwrap()).unwrap();

    update_global_settings(env_patch(&[("B", "2")])).expect("second update");

    let got = read_json(&settings_file);
    assert_eq!(got["externallyAdded"], "from-cli");
    assert_eq!(got["env"]["B"], "2");
    drop(h);
}
