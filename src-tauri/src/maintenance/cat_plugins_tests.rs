//! Ported from `internal/maintenance/cat_plugins_test.go`.

use std::collections::HashMap;
use std::path::Path;

use chrono::Utc;

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::scan_category;
use crate::maintenance::types::{Candidate, CategorySpec};

fn build_plugins_fixture(root: &Path) {
    write_file(&root.join("plugins/cache/acme/linter/1.0.0/x.js"), "aaaa");
    write_file(&root.join("plugins/cache/acme/formatter/2.0.0/y.js"), "bb");
    write_file(&root.join("plugins/marketplaces/acme/index.json"), "{}");
    std::fs::create_dir_all(root.join("plugins/repos")).unwrap(); // exists but empty
    write_file(&root.join("plugins/installed_plugins.json"), "{}");
    write_file(&root.join("plugins/config.json"), "{}");
}

#[test]
fn test_scan_plugins() {
    let tmp = TempDir::new("plugins");
    let root = tmp.path();
    build_plugins_fixture(root);

    let spec = CategorySpec {
        id: "plugins".to_string(),
        root: root.to_string_lossy().into_owned(),
        now: Utc::now(),
        enabled: vec!["linter@acme".to_string()],
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();

    let mut by_plugin: HashMap<String, Candidate> = HashMap::new();
    let mut groups: HashMap<String, usize> = HashMap::new();
    for c in &cands {
        *groups.entry(c.group.clone()).or_insert(0) += 1;
        if c.group == "cache" {
            by_plugin.insert(c.meta["plugin"].clone(), c.clone());
        }
    }

    assert_eq!(groups.get("cache").copied().unwrap_or(0), 2, "cache count: {groups:?}");
    assert_eq!(groups.get("marketplaces").copied().unwrap_or(0), 1);
    assert_eq!(groups.get("repos").copied().unwrap_or(0), 0, "empty repos/ → 0");

    for c in &cands {
        let base = Path::new(&c.path).file_name().unwrap().to_string_lossy();
        assert!(
            base != "installed_plugins.json" && base != "config.json",
            "config file leaked: {}",
            c.path
        );
    }

    assert_eq!(by_plugin["linter"].meta["enabled"], "true");
    assert_eq!(by_plugin["formatter"].meta["enabled"], "false");
    assert_eq!(by_plugin["linter"].meta["layoutAnomaly"], "repos-empty");
    assert_eq!(by_plugin["linter"].bytes, 4);
}

#[test]
fn test_scan_plugins_enabled_by_bare_name() {
    let tmp = TempDir::new("plugins-bare");
    let root = tmp.path();
    build_plugins_fixture(root);

    let spec = CategorySpec {
        id: "plugins".to_string(),
        root: root.to_string_lossy().into_owned(),
        now: Utc::now(),
        enabled: vec!["formatter".to_string()],
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();
    for c in &cands {
        if c.group == "cache" && c.meta.get("plugin").map(String::as_str) == Some("formatter") {
            assert_eq!(c.meta["enabled"], "true", "formatter enabled by bare name");
        }
    }
}
