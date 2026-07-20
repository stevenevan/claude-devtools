//! Ports `TestCaptureRestoreRoundTrip` to Rust temp dirs. NEVER touches the real
//! `~/.claude`. Capture a profile, mutate it, restore, assert every file (incl.
//! settings.json via the sanctioned writer, which leaves a `.bak`) is reverted.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::restore_config;
use crate::configbackup::capture::capture_config;
use crate::files::settings_write::test_home::{redirect_home, unique_temp_dir, HomeGuard};

fn setup() -> (HomeGuard, PathBuf, PathBuf) {
    let guard = redirect_home();
    let root = guard.claude_dir.clone();
    fs::create_dir_all(&root).unwrap();
    let app_data = unique_temp_dir("configbackup-appdata");
    fs::create_dir_all(&app_data).unwrap();
    (guard, root, app_data)
}

fn write_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn read_json_map(path: &Path) -> Map<String, Value> {
    let raw = fs::read(path).unwrap();
    serde_json::from_slice(&raw).unwrap()
}

#[test]
fn capture_restore_round_trip() {
    let (_guard, root, app_data) = setup();
    write_file(
        &root.join("settings.json"),
        r#"{"theme":"dark","env":{"FOO":"bar"}}"#,
    );
    write_file(&root.join("CLAUDE.md"), "# Global\noriginal claude md\n");
    write_file(&root.join("rules").join("style.md"), "rule content\n");
    write_file(
        &root.join("agents").join("helper.md"),
        "---\nname: helper\n---\nbody\n",
    );

    let m = capture_config(&root, &app_data, "snap1", false).unwrap();
    assert!(!m.files.is_empty(), "no files captured");

    write_file(&root.join("CLAUDE.md"), "# MUTATED\n");
    write_file(&root.join("rules").join("style.md"), "MUTATED rule\n");
    write_file(&root.join("settings.json"), r#"{"theme":"light"}"#);

    restore_config(&root, &app_data, &m.id, &[]).unwrap();

    assert_eq!(
        fs::read_to_string(root.join("CLAUDE.md")).unwrap(),
        "# Global\noriginal claude md\n"
    );
    assert_eq!(
        fs::read_to_string(root.join("rules").join("style.md")).unwrap(),
        "rule content\n"
    );
    assert_eq!(
        fs::read_to_string(root.join("agents").join("helper.md")).unwrap(),
        "---\nname: helper\n---\nbody\n"
    );

    let settings = read_json_map(&root.join("settings.json"));
    assert_eq!(
        settings.get("theme").and_then(Value::as_str),
        Some("dark"),
        "settings.json not restored"
    );
    assert!(
        root.join("settings.json.bak").exists(),
        "settings.json.bak missing after restore"
    );
}
