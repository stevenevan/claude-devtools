//! Ports the import + trust-gate cases of `configbackup_test.go` to Rust temp
//! dirs. NEVER touches the real `~/.claude` — `redirect_home` points `$HOME` at
//! a fresh temp dir under the shared env lock. Covers the zip-slip + oversized-
//! entry + entry-count + hooks-disarm + pre-import-snapshot/undo cases.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::{apply_import, validate_import, MAX_ENTRY_BYTES, MAX_IMPORT_ENTRIES};
use crate::configbackup::restore::restore_config;
use crate::configbackup::store::list_config_backups;
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

// Applies the committed fixture archive and asserts the expected post-import
// settings.json and hooks-disabled.json bytes. Uses redirect_home; never touches
// real ~/.claude.
#[test]
fn apply_import_matches_go_golden() {
    #[derive(serde::Deserialize)]
    struct Golden {
        settings: String,
        #[serde(rename = "hooksDisabled")]
        hooks_disabled: String,
    }
    let base = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/parity/");
    let fixture = Path::new(base).join("configbackup_fixture.zip");
    let golden_raw = fs::read_to_string(Path::new(base).join("configbackup_import.golden.json"))
        .unwrap_or_else(|e| panic!("read committed import fixture: {e}"));
    let golden: Golden = serde_json::from_str(&golden_raw).expect("parse golden");

    let (_guard, root, app_data) = setup();
    apply_import(&root, &app_data, &fixture, &["settings".to_string()]).unwrap();

    let settings = fs::read_to_string(root.join("settings.json")).unwrap();
    let disabled = fs::read_to_string(app_data.join("hooks-disabled.json")).unwrap();
    assert_eq!(settings, golden.settings, "settings.json bytes differ from Go");
    assert_eq!(
        disabled, golden.hooks_disabled,
        "hooks-disabled.json bytes differ from Go"
    );
}

fn build_zip(entries: &[(String, Vec<u8>)]) -> PathBuf {
    let dir = unique_temp_dir("configbackup-archive");
    fs::create_dir_all(&dir).unwrap();
    let dest = dir.join("archive.zip");
    let file = File::create(&dest).unwrap();
    let mut zw = ZipWriter::new(file);
    for (name, content) in entries {
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zw.start_file(name.clone(), opts).unwrap();
        zw.write_all(content).unwrap();
    }
    zw.finish().unwrap();
    dest
}

/// Zips entries verbatim (no manifest synthesis) — for the malicious-entry /
/// zip-bomb cases rejected before any manifest check. Mirrors `makeRawArchive`.
fn make_raw_archive(entries: &[(&str, &str)]) -> PathBuf {
    let owned: Vec<(String, Vec<u8>)> = entries
        .iter()
        .map(|(n, c)| (n.to_string(), c.as_bytes().to_vec()))
        .collect();
    build_zip(&owned)
}

/// Builds a valid import archive (files + a schema-valid manifest). Mirrors
/// `makeArchive`.
fn make_archive(entries: &[(&str, &str)], secrets_included: bool) -> PathBuf {
    let mut files = Vec::new();
    for (name, content) in entries {
        let sum = Sha256::digest(content.as_bytes());
        let sha: String = sum.iter().map(|b| format!("{b:02x}")).collect();
        files.push(serde_json::json!({
            "relPath": name,
            "size": content.len(),
            "sha256": sha,
        }));
    }
    let manifest = serde_json::json!({
        "id": "test-backup-id",
        "label": "imported",
        "createdMs": 1,
        "secretsIncluded": secrets_included,
        "files": files,
        "skillLinks": [],
    });
    let manifest_str = serde_json::to_string_pretty(&manifest).unwrap();
    let mut owned: Vec<(String, Vec<u8>)> = entries
        .iter()
        .map(|(n, c)| (n.to_string(), c.as_bytes().to_vec()))
        .collect();
    owned.push(("manifest.json".to_string(), manifest_str.into_bytes()));
    build_zip(&owned)
}

#[test]
fn validate_import_rejects_malicious_entries() {
    let cases = [
        "../../evil",
        "/etc/evil",
        "agents/../../x",
        "projects/x/evil.jsonl",
    ];
    for entry in cases {
        let archive = make_raw_archive(&[(entry, "payload")]);
        assert!(
            validate_import(&archive).is_err(),
            "expected rejection for entry {entry:?}"
        );
    }
}

#[test]
fn validate_import_rejects_zip_bomb() {
    let too_many: Vec<(String, Vec<u8>)> = (0..MAX_IMPORT_ENTRIES + 1)
        .map(|i| (format!("rules/f{i}.md"), b"x".to_vec()))
        .collect();
    assert!(
        validate_import(&build_zip(&too_many)).is_err(),
        "expected rejection for too many entries"
    );

    let big = "A".repeat(MAX_ENTRY_BYTES as usize + 10);
    let oversized = vec![("rules/big.md".to_string(), big.into_bytes())];
    assert!(
        validate_import(&build_zip(&oversized)).is_err(),
        "expected rejection for an oversized entry"
    );
}

#[test]
fn apply_import_strips_hooks_from_settings() {
    let (_guard, root, app_data) = setup();
    write_file(&root.join("settings.json"), r#"{"theme":"dark"}"#);

    let imported_settings = r#"{
        "theme": "light",
        "hooks": {
            "PreToolUse": [
                {"matcher":"Bash","hooks":[{"type":"command","command":"echo IMPORTED_HOOK"}]}
            ]
        }
    }"#;
    let archive = make_archive(&[("settings.json", imported_settings)], true);

    apply_import(&root, &app_data, &archive, &["settings".to_string()]).unwrap();

    let settings = read_json_map(&root.join("settings.json"));
    assert!(
        !settings.contains_key("hooks"),
        "settings.json still has a hooks key after import (ACE hole)"
    );
    assert_eq!(settings.get("theme").and_then(Value::as_str), Some("light"));

    let disabled = read_json_map(&app_data.join("hooks-disabled.json"));
    let pre = disabled
        .get("PreToolUse")
        .and_then(Value::as_array)
        .expect("imported hook not routed to hooks-disabled.json");
    assert!(!pre.is_empty(), "imported hook not routed to hooks-disabled.json");
    assert_eq!(
        pre[0]["hooks"][0]["command"].as_str(),
        Some("echo IMPORTED_HOOK")
    );
}

#[test]
fn apply_import_creates_pre_import_snapshot_and_undo_reverts() {
    let (_guard, root, app_data) = setup();
    write_file(&root.join("settings.json"), r#"{"theme":"dark"}"#);
    write_file(&root.join("CLAUDE.md"), "ORIGINAL\n");
    write_file(
        &app_data.join("hooks-disabled.json"),
        r#"{"PreToolUse":[{"matcher":"X","hooks":[{"type":"command","command":"echo pre"}]}]}"#,
    );

    let imported = r#"{"theme":"light","hooks":{"SessionStart":[{"matcher":"*","hooks":[{"type":"command","command":"echo NEW"}]}]}}"#;
    let archive = make_archive(
        &[
            ("settings.json", imported),
            ("CLAUDE.md", "IMPORTED CLAUDE\n"),
        ],
        true,
    );

    apply_import(
        &root,
        &app_data,
        &archive,
        &["settings".to_string(), "instructions".to_string()],
    )
    .unwrap();

    // Pre-import snapshot exists.
    let backups = list_config_backups(&app_data).unwrap();
    let pre_import_id = backups
        .iter()
        .find(|b| b.label == "pre-import")
        .map(|b| b.id.clone())
        .expect("no pre-import snapshot created");

    // Import applied.
    assert_eq!(
        read_json_map(&root.join("settings.json"))
            .get("theme")
            .and_then(Value::as_str),
        Some("light")
    );
    assert_eq!(
        fs::read_to_string(root.join("CLAUDE.md")).unwrap(),
        "IMPORTED CLAUDE\n"
    );
    let disabled = read_json_map(&app_data.join("hooks-disabled.json"));
    let session_start = disabled.get("SessionStart").and_then(Value::as_array);
    assert!(
        session_start.map(|a| !a.is_empty()).unwrap_or(false),
        "imported hook not disabled"
    );

    // One-click undo restores everything (incl. hooks-disabled.json).
    restore_config(&root, &app_data, &pre_import_id, &[]).unwrap();
    assert_eq!(
        read_json_map(&root.join("settings.json"))
            .get("theme")
            .and_then(Value::as_str),
        Some("dark"),
        "undo did not revert settings.json"
    );
    assert_eq!(
        fs::read_to_string(root.join("CLAUDE.md")).unwrap(),
        "ORIGINAL\n"
    );
    let reverted = read_json_map(&app_data.join("hooks-disabled.json"));
    assert!(
        !reverted.contains_key("SessionStart"),
        "undo did not remove the appended disabled group"
    );
    assert!(
        reverted.contains_key("PreToolUse"),
        "undo lost the original disabled group"
    );
}
