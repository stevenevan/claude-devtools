//! Ports `plugins_write_test.go`. IO cases redirect `$HOME` to a temp dir via
//! the shared `settings_write::test_home` scaffolding (never the real
//! `~/.claude`); the duplicate-detection case is pure.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::{
    dedupe_plugin, detect_plugin_duplicates, set_plugin_enabled, Plugin,
};
use crate::files::settings_write::test_home::{redirect_home, write_settings_file, HomeGuard};

// Carries an unrelated top-level key and an unrelated enabledPlugins entry, to
// prove the editors never touch anything outside the key(s) they change.
const PLUGINS_SETTINGS_SEED: &str = r#"{
    "theme": "dark",
    "enabledPlugins": {
        "some-other-plugin@some-marketplace": true
    }
}"#;

fn settings_paths() -> (HomeGuard, PathBuf, PathBuf) {
    let h = redirect_home();
    let dir = h.claude_dir.clone();
    let settings_file = dir.join("settings.json");
    (h, dir, settings_file)
}

fn read_settings(path: &Path) -> Map<String, Value> {
    let raw = fs::read_to_string(path).expect("read settings.json");
    match serde_json::from_str(&raw).expect("parse settings.json") {
        Value::Object(m) => m,
        other => panic!("settings.json not an object: {other}"),
    }
}

fn enabled_map(settings: &Map<String, Value>) -> Map<String, Value> {
    match settings.get("enabledPlugins") {
        Some(Value::Object(m)) => m.clone(),
        other => panic!("enabledPlugins missing/not object: {other:?}"),
    }
}

fn plugin(id: &str, name: &str, marketplace: &str, enabled: bool) -> Plugin {
    Plugin {
        id: id.to_string(),
        name: name.to_string(),
        marketplace: marketplace.to_string(),
        enabled,
        ..Default::default()
    }
}

#[test]
fn set_enabled_round_trip_preserves_unrelated_keys() {
    let (h, dir, settings_file) = settings_paths();
    write_settings_file(&dir, &settings_file, PLUGINS_SETTINGS_SEED);

    let key = "chrome-devtools-mcp@chrome-devtools-plugins";

    set_plugin_enabled(key, true).expect("set_plugin_enabled(enable)");
    let after_enable = read_settings(&settings_file);
    let enabled_after_enable = enabled_map(&after_enable);
    assert_eq!(enabled_after_enable.get(key), Some(&Value::Bool(true)));
    assert_eq!(after_enable.get("theme"), Some(&Value::from("dark")));
    assert_eq!(
        enabled_after_enable.get("some-other-plugin@some-marketplace"),
        Some(&Value::Bool(true))
    );

    set_plugin_enabled(key, false).expect("set_plugin_enabled(disable)");
    let after_disable = read_settings(&settings_file);
    let enabled_after_disable = enabled_map(&after_disable);
    assert!(!enabled_after_disable.contains_key(key), "key still present after disable");
    assert_eq!(after_disable.get("theme"), Some(&Value::from("dark")));

    let mut want = Map::new();
    want.insert("some-other-plugin@some-marketplace".to_string(), Value::Bool(true));
    assert_eq!(enabled_after_disable, want);
    drop(h);
}

#[test]
fn set_enabled_disable_removes_exactly_one_entry() {
    let (h, dir, settings_file) = settings_paths();
    let seed = r#"{
        "enabledPlugins": {
            "plugin-a@marketplace-1": true,
            "plugin-b@marketplace-1": true
        }
    }"#;
    write_settings_file(&dir, &settings_file, seed);

    set_plugin_enabled("plugin-a@marketplace-1", false).expect("set_plugin_enabled");

    let settings = read_settings(&settings_file);
    let enabled = enabled_map(&settings);
    let mut want = Map::new();
    want.insert("plugin-b@marketplace-1".to_string(), Value::Bool(true));
    assert_eq!(enabled, want);
    drop(h);
}

#[test]
fn dedupe_keeps_only_keep_key() {
    let (h, dir, settings_file) = settings_paths();
    let seed = r#"{
        "enabledPlugins": {
            "chrome-devtools-mcp@keep": true,
            "chrome-devtools-mcp@other": true,
            "unrelated-plugin@some-marketplace": true
        }
    }"#;
    write_settings_file(&dir, &settings_file, seed);

    dedupe_plugin("chrome-devtools-mcp", "chrome-devtools-mcp@keep").expect("dedupe_plugin");

    let settings = read_settings(&settings_file);
    let enabled = enabled_map(&settings);
    let mut want = Map::new();
    want.insert("chrome-devtools-mcp@keep".to_string(), Value::Bool(true));
    want.insert("unrelated-plugin@some-marketplace".to_string(), Value::Bool(true));
    assert_eq!(enabled, want);
    drop(h);
}

#[test]
fn dedupe_removes_bare_name_key() {
    let (h, dir, settings_file) = settings_paths();
    let seed = r#"{
        "enabledPlugins": {
            "chrome-devtools-mcp": true,
            "chrome-devtools-mcp@keep": true,
            "unrelated-plugin@some-marketplace": true
        }
    }"#;
    write_settings_file(&dir, &settings_file, seed);

    dedupe_plugin("chrome-devtools-mcp", "chrome-devtools-mcp@keep").expect("dedupe_plugin");

    let settings = read_settings(&settings_file);
    let enabled = enabled_map(&settings);
    let mut want = Map::new();
    want.insert("chrome-devtools-mcp@keep".to_string(), Value::Bool(true));
    want.insert("unrelated-plugin@some-marketplace".to_string(), Value::Bool(true));
    assert_eq!(enabled, want);
    drop(h);
}

#[test]
fn detect_duplicates_flags_multi_marketplace() {
    let plugins = vec![
        plugin(
            "chrome-devtools-mcp@chrome-devtools-plugins",
            "chrome-devtools-mcp",
            "chrome-devtools-plugins",
            true,
        ),
        plugin(
            "chrome-devtools-mcp@claude-plugins-official",
            "chrome-devtools-mcp",
            "claude-plugins-official",
            true,
        ),
        plugin(
            "single-marketplace-plugin@some-marketplace",
            "single-marketplace-plugin",
            "some-marketplace",
            true,
        ),
        plugin(
            "not-enabled-elsewhere@marketplace-a",
            "not-enabled-elsewhere",
            "marketplace-a",
            true,
        ),
        plugin(
            "not-enabled-elsewhere@marketplace-b",
            "not-enabled-elsewhere",
            "marketplace-b",
            false,
        ),
    ];

    let got = detect_plugin_duplicates(&plugins);

    assert_eq!(got.len(), 1, "{got:?}");
    assert_eq!(got[0].name, "chrome-devtools-mcp");
    assert_eq!(got[0].entries.len(), 2, "{:?}", got[0].entries);
    assert_eq!(got[0].entries[0].marketplace, "chrome-devtools-plugins");
    assert_eq!(got[0].entries[1].marketplace, "claude-plugins-official");
}

#[test]
fn installed_plugins_json_byte_identical_across_toggle_and_dedupe() {
    let (h, dir, settings_file) = settings_paths();
    let seed = r#"{
        "enabledPlugins": {
            "chrome-devtools-mcp@chrome-devtools-plugins": true,
            "chrome-devtools-mcp@claude-plugins-official": true
        }
    }"#;
    write_settings_file(&dir, &settings_file, seed);

    let plugins_dir = dir.join("plugins");
    fs::create_dir_all(&plugins_dir).expect("mkdir plugins dir");
    let installed_file = plugins_dir.join("installed_plugins.json");
    let installed_seed = r#"{
  "plugins": {
    "chrome-devtools-mcp@chrome-devtools-plugins": [
      {
        "version": "1.2.0",
        "installedAt": "2026-01-01T00:00:00.000Z",
        "lastUpdated": "2026-01-01T00:00:00.000Z"
      }
    ],
    "chrome-devtools-mcp@claude-plugins-official": [
      {
        "version": "1.2.0",
        "installedAt": "2026-02-01T00:00:00.000Z",
        "lastUpdated": "2026-02-01T00:00:00.000Z"
      }
    ]
  }
}"#;
    fs::write(&installed_file, installed_seed).expect("write installed_plugins.json");
    let before = fs::read(&installed_file).expect("read installed_plugins.json before");

    set_plugin_enabled("chrome-devtools-mcp@chrome-devtools-plugins", false).expect("set_plugin_enabled");
    dedupe_plugin("chrome-devtools-mcp", "chrome-devtools-mcp@claude-plugins-official").expect("dedupe_plugin");

    let after = fs::read(&installed_file).expect("read installed_plugins.json after");
    assert_eq!(before, after, "installed_plugins.json bytes changed");

    let settings = read_settings(&settings_file);
    let enabled = enabled_map(&settings);
    let mut want = Map::new();
    want.insert("chrome-devtools-mcp@claude-plugins-official".to_string(), Value::Bool(true));
    assert_eq!(enabled, want);
    drop(h);
}
