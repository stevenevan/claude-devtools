use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::types::codex_inventory::{CodexEnabledState, CodexInventoryScope, CodexRecordKind};
use crate::types::codex_plugins::{CodexPluginCapabilityKind, CodexPluginState};

fn fixture(name: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codex-plugins-{name}-{nonce}"));
    fs::create_dir_all(&root).expect("fixture root");
    root
}

fn global_scope() -> CodexInventoryScope {
    CodexInventoryScope::Global
}

fn write_plugin(root: &Path, relative: &str, manifest: &str) -> std::path::PathBuf {
    let package = root.join(relative);
    fs::create_dir_all(package.join(".codex-plugin")).expect("manifest directory");
    fs::write(package.join(".codex-plugin/plugin.json"), manifest).expect("manifest");
    package
}

#[test]
fn valid_plugin_reports_bounded_capabilities_and_owner_links() {
    let root = fixture("valid");
    let package = write_plugin(
        &root,
        "plugins/cache/community/browser/1.0.0",
        r#"{
          "name": "browser",
          "display_name": "Browser tools",
          "description": "Research helpers",
          "version": "1.0.0",
          "skills": "skills",
          "mcpServers": ".mcp.json"
        }"#,
    );
    fs::create_dir_all(package.join("skills/research")).expect("skill component");
    fs::write(
        package.join("skills/research/SKILL.md"),
        "---\nname: research\n---\n",
    )
    .expect("skill");
    fs::write(
        package.join(".mcp.json"),
        r#"{"mcpServers": {"browser": {}}}"#,
    )
    .expect("mcp metadata");

    let inventory = discover(&root, &global_scope(), None).expect("discover");
    assert_eq!(inventory.view.items.len(), 1);
    let plugin = &inventory.view.items[0];
    assert_eq!(plugin.state, CodexPluginState::Installed);
    assert_eq!(plugin.enabled_state, CodexEnabledState::Unknown);
    assert!(plugin.capabilities.iter().any(|capability| capability.kind
        == CodexPluginCapabilityKind::Skill
        && capability.name == "research"
        && capability.linked_record_id.is_some()));
    assert!(plugin
        .capabilities
        .iter()
        .any(|capability| capability.kind == CodexPluginCapabilityKind::McpServer));
    assert_eq!(inventory.skill_roots.len(), 1);
    assert_eq!(inventory.mcp_roots.len(), 1);
    assert_eq!(inventory.skill_roots[0].owner_plugin_id, plugin.id);
    assert!(!serde_json::to_string(plugin)
        .expect("serialize")
        .contains("mcpServers"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn malformed_manifest_does_not_hide_other_plugins() {
    let root = fixture("malformed");
    write_plugin(
        &root,
        "plugins/cache/community/broken/1.0.0",
        "{ not valid json",
    );
    write_plugin(
        &root,
        "plugins/cache/community/valid/1.0.0",
        r#"{"name":"valid","description":"safe","version":"1"}"#,
    );

    let inventory = discover(&root, &global_scope(), None).expect("discover");
    assert_eq!(inventory.view.items.len(), 2);
    assert!(inventory
        .view
        .items
        .iter()
        .any(|item| item.state == CodexPluginState::Invalid));
    assert!(inventory.view.items.iter().any(|item| item.name == "valid"));
    let json = serde_json::to_string(&inventory.view).expect("serialize");
    assert!(!json.contains("not valid json"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn unsafe_capability_and_duplicate_marketplace_entries_are_diagnosed() {
    let root = fixture("unsafe");
    let package = write_plugin(
        &root,
        "plugins/cache/community/unsafe/1.0.0",
        r#"{"name":"unsafe","description":"api_key=not-a-secret","skills":"../outside"}"#,
    );
    fs::create_dir_all(root.join("outside")).expect("outside");
    let marketplace = root.join("plugins/marketplaces/local/.codex-plugin");
    fs::create_dir_all(&marketplace).expect("marketplace");
    fs::write(
        marketplace.join("marketplace.json"),
        r#"{"plugins":[{"name":"market","description":"first"},{"name":"market","description":"second"}]}"#,
    )
    .expect("marketplace");

    let inventory = discover(&root, &global_scope(), None).expect("discover");
    let unsafe_plugin = inventory
        .view
        .items
        .iter()
        .find(|item| item.name == "unsafe")
        .expect("unsafe plugin");
    assert!(unsafe_plugin
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "unsafe-capability-path"));
    assert!(!serde_json::to_string(unsafe_plugin)
        .expect("serialize")
        .contains("api_key=not-a-secret"));
    let market = inventory
        .view
        .items
        .iter()
        .find(|item| item.name == "market")
        .expect("marketplace entry");
    assert_eq!(market.state, CodexPluginState::Available);
    assert!(market
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "duplicate-plugin"));
    assert!(
        source_identity(&global_scope(), CodexRecordKind::Skill, "skills/research")
            .id
            .starts_with("cdx-")
    );
    let _ = fs::remove_dir_all(root);
    let _ = package;
}

#[cfg(unix)]
#[test]
fn symlinked_plugin_directory_is_not_followed() {
    let root = fixture("symlink");
    let external = fixture("external");
    write_plugin(&external, "plugin", r#"{"name":"external"}"#);
    fs::create_dir_all(root.join("plugins/cache/community")).expect("cache");
    std::os::unix::fs::symlink(
        external.join("plugin"),
        root.join("plugins/cache/community/external"),
    )
    .expect("symlink");

    let inventory = discover(&root, &global_scope(), None).expect("discover");
    assert!(inventory.view.items.is_empty());
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(external);
}
