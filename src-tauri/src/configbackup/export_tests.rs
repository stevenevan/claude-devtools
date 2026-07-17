//! Ports `TestExportRedactsSecretsEverywhere` to Rust temp dirs. NEVER touches
//! the real `~/.claude`. A default export greps to ZERO occurrences of the
//! secret across the whole archive; an opt-in export carries it verbatim and
//! flags the manifest.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;
use zip::ZipArchive;

use super::export_backup;
use crate::configbackup::capture::capture_config;
use crate::files::settings_write::test_home::{redirect_home, unique_temp_dir, HomeGuard};

const SECRET: &str = "sk-verysecretcredential1234567890";

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

fn read_archive(path: &Path) -> HashMap<String, String> {
    let file = File::open(path).unwrap();
    let mut a = ZipArchive::new(file).unwrap();
    let mut out = HashMap::new();
    for i in 0..a.len() {
        let mut e = a.by_index(i).unwrap();
        let name = e.name().to_string();
        let mut s = String::new();
        e.read_to_string(&mut s).unwrap();
        out.insert(name, s);
    }
    out
}

fn archive_secrets_included(path: &Path) -> bool {
    let raw = read_archive(path)
        .remove("manifest.json")
        .expect("archive has no manifest.json");
    let v: Value = serde_json::from_str(&raw).unwrap();
    v.get("secretsIncluded").and_then(Value::as_bool).unwrap()
}

#[test]
fn export_redacts_secrets_everywhere() {
    let (_guard, root, app_data) = setup();
    write_file(
        &root.join("settings.json"),
        &format!(r#"{{"env":{{"API_KEY":"{SECRET}"}},"theme":"dark"}}"#),
    );
    write_file(&root.join("CLAUDE.md"), &format!("token here: {SECRET}\nmore text\n"));
    write_file(&root.join("agents").join("a.md"), &format!("agent uses {SECRET}\n"));
    write_file(
        &root
            .join("projects")
            .join("-Users-x-proj")
            .join("memory")
            .join("fact.md"),
        &format!("remember {SECRET}\n"),
    );

    let m = capture_config(&root, &app_data, "secret-snap", false).unwrap();

    let dest_dir = unique_temp_dir("configbackup-export");
    fs::create_dir_all(&dest_dir).unwrap();

    // Default export: whole-archive grep finds ZERO occurrences of the secret.
    let dest = dest_dir.join("default.zip");
    export_backup(&app_data, &m.id, &dest, false).unwrap();
    for (name, content) in read_archive(&dest) {
        assert!(
            !content.contains(SECRET),
            "default export leaked secret in {name:?}"
        );
    }
    assert!(
        !archive_secrets_included(&dest),
        "default export flagged secretsIncluded=true"
    );

    // Opt-in export: verbatim, flagged.
    let dest2 = dest_dir.join("optin.zip");
    export_backup(&app_data, &m.id, &dest2, true).unwrap();
    assert!(
        archive_secrets_included(&dest2),
        "opt-in export not flagged secretsIncluded=true"
    );
    let found = read_archive(&dest2).values().any(|c| c.contains(SECRET));
    assert!(found, "opt-in export did not carry the secret verbatim");
}
