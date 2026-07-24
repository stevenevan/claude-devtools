//! `tempfile` is not a dep → use `std::env::temp_dir()` + a unique subdir
//! (never touches real `~/.claude` files), matching `claude_read_tests.rs`.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;

fn make_temp_root() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "claude-marketplace-test-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(dir.join("plugins")).unwrap();
    fs::canonicalize(&dir).unwrap()
}

fn write_known_marketplaces(root: &PathBuf, json: &str) {
    fs::write(root.join("plugins/known_marketplaces.json"), json).unwrap();
}

fn write_marketplace_manifest(root: &PathBuf, name: &str, json: &str) {
    let dir = root.join("plugins/marketplaces").join(name).join(".claude-plugin");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("marketplace.json"), json).unwrap();
}

fn write_installed_plugins(root: &PathBuf, json: &str) {
    fs::write(root.join("plugins/installed_plugins.json"), json).unwrap();
}

#[test]
fn parses_plugins_with_installed_cross_ref_and_source() {
    let root = make_temp_root();
    write_known_marketplaces(
        &root,
        r#"{
            "anthropic-agent-skills": {
                "source": {"source": "github", "repo": "anthropics/skills"},
                "installLocation": "/some/path",
                "lastUpdated": "2026-07-24T10:00:00.000Z"
            }
        }"#,
    );
    write_marketplace_manifest(
        &root,
        "anthropic-agent-skills",
        r#"{
            "name": "anthropic-agent-skills",
            "description": "Skills marketplace",
            "owner": "anthropic",
            "plugins": [
                {"name": "pdf", "description": "PDF skill"},
                {"name": "xlsx", "description": "Spreadsheet skill"}
            ]
        }"#,
    );
    write_installed_plugins(
        &root,
        r#"{"plugins": {"pdf@anthropic-agent-skills": []}, "version": 1}"#,
    );

    let catalog =
        read_marketplace_catalog(&root.to_string_lossy()).expect("read_marketplace_catalog");
    assert_eq!(catalog.marketplaces.len(), 1);

    let marketplace = &catalog.marketplaces[0];
    assert_eq!(marketplace.name, "anthropic-agent-skills");
    assert_eq!(marketplace.source.as_deref(), Some("github:anthropics/skills"));
    assert_eq!(
        marketplace.last_updated.as_deref(),
        Some("2026-07-24T10:00:00.000Z")
    );
    assert_eq!(marketplace.plugins.len(), 2);

    let pdf = marketplace.plugins.iter().find(|p| p.name == "pdf").unwrap();
    assert_eq!(pdf.description.as_deref(), Some("PDF skill"));
    assert!(pdf.installed, "pdf@anthropic-agent-skills is in installed_plugins.json");

    let xlsx = marketplace.plugins.iter().find(|p| p.name == "xlsx").unwrap();
    assert!(!xlsx.installed, "xlsx@anthropic-agent-skills is not installed");
}

#[test]
fn missing_manifest_yields_empty_plugins_not_error() {
    let root = make_temp_root();
    write_known_marketplaces(
        &root,
        r#"{"no-manifest": {"source": {"source": "github", "repo": "x/y"}}}"#,
    );
    // Note: no marketplace.json written for "no-manifest".

    let catalog =
        read_marketplace_catalog(&root.to_string_lossy()).expect("read_marketplace_catalog");
    assert_eq!(catalog.marketplaces.len(), 1);
    assert_eq!(catalog.marketplaces[0].name, "no-manifest");
    assert!(catalog.marketplaces[0].plugins.is_empty());
}

#[test]
fn missing_installed_plugins_file_means_nothing_installed() {
    let root = make_temp_root();
    write_known_marketplaces(
        &root,
        r#"{"m": {"source": {"source": "github", "repo": "a/b"}}}"#,
    );
    write_marketplace_manifest(
        &root,
        "m",
        r#"{"name": "m", "plugins": [{"name": "foo", "description": "x"}]}"#,
    );
    // Note: no installed_plugins.json written.

    let catalog =
        read_marketplace_catalog(&root.to_string_lossy()).expect("read_marketplace_catalog");
    assert_eq!(catalog.marketplaces.len(), 1);
    assert!(!catalog.marketplaces[0].plugins[0].installed);
}

#[test]
fn missing_known_marketplaces_yields_empty_catalog() {
    let root = make_temp_root();
    let catalog =
        read_marketplace_catalog(&root.to_string_lossy()).expect("read_marketplace_catalog");
    assert!(catalog.marketplaces.is_empty());
}
