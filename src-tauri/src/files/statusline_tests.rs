//! Every test that touches the settings write path redirects `$HOME` first —
//! the writer hardcodes `$HOME/.claude`, so without the guard these would
//! clobber the real `~/.claude/settings.json`.

use std::fs;

use serde_json::{json, Value};

use super::super::settings_write::test_home::redirect_home;
use super::*;

fn write_settings(dir: &Path, value: Value) {
    fs::create_dir_all(dir).unwrap();
    fs::write(
        dir.join("settings.json"),
        serde_json::to_string_pretty(&value).unwrap(),
    )
    .unwrap();
}

fn read_settings(dir: &Path) -> Value {
    let raw = fs::read_to_string(dir.join("settings.json")).unwrap();
    serde_json::from_str(&raw).unwrap()
}

fn config(command: &str) -> StatusLineConfig {
    StatusLineConfig {
        r#type: "command".to_string(),
        command: command.to_string(),
        padding: None,
        refresh_interval: None,
        hide_vim_mode_indicator: None,
        extra: Map::new(),
    }
}

#[test]
fn write_status_line_preserves_other_top_level_keys() {
    let h = redirect_home();
    write_settings(
        &h.claude_dir,
        json!({ "theme": "dark", "env": { "A": "1" } }),
    );

    let mut cfg = config("~/.claude/status-line");
    cfg.padding = Some(2);
    write_status_line(Some(cfg)).expect("write_status_line");

    let after = read_settings(&h.claude_dir);
    assert_eq!(after["theme"], json!("dark"));
    assert_eq!(after["env"], json!({ "A": "1" }));
    assert_eq!(after["statusLine"]["type"], json!("command"));
    assert_eq!(after["statusLine"]["padding"], json!(2));
    // Unset optionals stay absent rather than becoming null.
    assert!(after["statusLine"].get("refreshInterval").is_none());
}

#[test]
fn unknown_status_line_subkey_survives_round_trip() {
    let h = redirect_home();
    write_settings(
        &h.claude_dir,
        json!({
            "statusLine": { "type": "command", "command": "/x/y", "futureKey": { "a": 1 } }
        }),
    );

    let loaded = read_status_line().expect("read").expect("present");
    assert_eq!(loaded.extra["futureKey"], json!({ "a": 1 }));

    write_status_line(Some(loaded)).expect("write_status_line");

    let after = read_settings(&h.claude_dir);
    assert_eq!(after["statusLine"]["futureKey"], json!({ "a": 1 }));
}

#[test]
fn write_status_line_none_removes_the_key() {
    let h = redirect_home();
    write_settings(
        &h.claude_dir,
        json!({ "theme": "dark", "statusLine": { "type": "command", "command": "/x/y" } }),
    );

    write_status_line(None).expect("write_status_line");

    let after = read_settings(&h.claude_dir);
    assert!(after.get("statusLine").is_none());
    assert_eq!(after["theme"], json!("dark"));
}

#[test]
fn read_status_line_absent_is_none() {
    let h = redirect_home();
    write_settings(&h.claude_dir, json!({ "theme": "dark" }));
    assert!(read_status_line().expect("read").is_none());
}

#[test]
fn read_status_line_malformed_is_err_not_none() {
    let h = redirect_home();
    write_settings(&h.claude_dir, json!({ "statusLine": "not-an-object" }));
    // Ok(None) here would render an empty form and overwrite the user's value.
    assert!(read_status_line().is_err());
}

#[test]
fn validate_rejects_bad_configs() {
    let mut wrong_type = config("/x/y");
    wrong_type.r#type = "other".to_string();
    assert!(validate(&wrong_type).is_err());

    assert!(validate(&config("   ")).is_err());

    let mut zero_interval = config("/x/y");
    zero_interval.refresh_interval = Some(0);
    assert!(validate(&zero_interval).is_err());

    assert!(validate(&config("/x/y")).is_ok());
}

#[test]
fn resolve_command_path_rejects_inline_shell_commands() {
    let root = Path::new("/home/u/.claude");
    assert!(resolve_command_path("jq -r '.model'", root).is_none());
    assert!(resolve_command_path("echo hi | cat", root).is_none());
    // Bare token: would otherwise resolve against the process CWD.
    assert!(resolve_command_path("jq", root).is_none());
    assert!(resolve_command_path("status-line", root).is_none());
    assert!(resolve_command_path("", root).is_none());
}

#[test]
fn resolve_command_path_accepts_paths_and_expands_tilde() {
    let root = Path::new("/home/u/.claude");
    assert_eq!(
        resolve_command_path("/home/u/.claude/status-line", root),
        Some(PathBuf::from("/home/u/.claude/status-line"))
    );
    assert_eq!(
        resolve_command_path("~/.claude/status-line", root),
        Some(PathBuf::from("/home/u/.claude/status-line"))
    );
    // A configurable root of "/" has no parent — must not panic.
    assert!(resolve_command_path("~/x", Path::new("/")).is_none());
}

#[test]
fn stat_classifies_binary_and_root_containment() {
    let h = redirect_home();
    fs::create_dir_all(&h.claude_dir).unwrap();

    let binary = h.claude_dir.join("status-line");
    fs::write(&binary, [0xCF, 0xFA, 0xED, 0xFE, 0x00, 0x01]).unwrap();
    let info = stat_status_line_script(&binary.to_string_lossy(), &h.claude_dir);
    assert!(info.exists);
    assert!(!info.is_text, "NUL byte must classify as binary");
    assert!(info.under_claude_root);
    assert_eq!(info.size_bytes, 6);

    let outside = h.home.join("outside.sh");
    fs::write(&outside, "#!/bin/sh\necho hi\n").unwrap();
    let info = stat_status_line_script(&outside.to_string_lossy(), &h.claude_dir);
    assert!(info.exists);
    assert!(info.is_text);
    assert!(!info.under_claude_root);
}

#[test]
fn stat_inline_command_has_no_resolved_path() {
    let h = redirect_home();
    let info = stat_status_line_script("jq -r '.model.display_name'", &h.claude_dir);
    assert!(info.resolved_path.is_none());
    assert!(!info.exists);
}
