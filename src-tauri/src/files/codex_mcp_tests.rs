use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::config::codex_context::normalize_project_context;
use crate::types::codex_inventory::CodexInventoryScope;
use crate::types::codex_mcp::{CodexMcpCheckState, CodexMcpEnabledState, CodexMcpTransport};

fn fixture(name: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codex-mcp-{name}-{nonce}"));
    fs::create_dir_all(&root).expect("fixture root");
    root
}

fn write_plugin(root: &Path, manifest: &str, mcp: &str) {
    let package = root.join("plugins/cache/community/browser/1.0.0");
    fs::create_dir_all(package.join(".codex-plugin")).expect("plugin manifest");
    fs::write(package.join(".codex-plugin/plugin.json"), manifest).expect("manifest");
    fs::write(package.join(".mcp.json"), mcp).expect("mcp");
}

#[test]
fn reads_stdio_and_plugin_http_without_urls_or_credentials() {
    let root = fixture("servers");
    fs::write(
        root.join("config.toml"),
        r#"approval_policy = "on-request"
sandbox_mode = "workspace-write"

[mcp_servers.files]
type = "stdio"
command = "node"
args = ["--token", "sk-fixture-token"]
env = { TOKEN = "sk-fixture-token" }
enabled = true
enabled_tools = ["read"]

[plugins.browser.mcp_servers.browser]
enabled = false
enabled_tools = ["search"]
default_tools_approval_mode = "never"
"#,
    )
    .expect("config");
    write_plugin(
        &root,
        r#"{"name":"browser","mcpServers":".mcp.json"}"#,
        r#"{"mcpServers":{"browser":{"type":"http","url":"https://mcp.example/token","headers":{"Authorization":"Bearer fixture"},"tools":[{},{}]}}}"#,
    );

    let view = discover_at(&root, &CodexInventoryScope::Global, None, None).expect("discover");
    assert_eq!(view.servers.len(), 2);
    let files = view
        .servers
        .iter()
        .find(|server| server.name == "files")
        .expect("files server");
    assert_eq!(files.transport, CodexMcpTransport::Stdio);
    assert_eq!(files.enabled, CodexMcpEnabledState::Enabled);
    assert!(files.command_configured);
    assert!(!files.endpoint_configured);
    assert!(files.credentials_configured);
    assert_eq!(files.reachable, CodexMcpCheckState::NotChecked);
    assert_eq!(files.approval_observed, CodexMcpCheckState::NotChecked);
    assert_eq!(files.observed, CodexMcpCheckState::No);

    let browser = view
        .servers
        .iter()
        .find(|server| server.name == "browser")
        .expect("browser server");
    assert_eq!(browser.transport, CodexMcpTransport::Http);
    assert_eq!(browser.enabled, CodexMcpEnabledState::Disabled);
    assert!(browser.endpoint_configured);
    assert!(browser.credentials_configured);
    assert_eq!(browser.approval_mode.as_deref(), Some("never"));
    assert_eq!(browser.enabled_tools, vec!["search".to_string()]);
    assert!(browser.plugin_owner_id.is_some());
    assert_eq!(view.policy.approval_mode.as_deref(), Some("on-request"));
    assert_eq!(view.policy.sandbox_mode.as_deref(), Some("workspace-write"));
    let json = serde_json::to_string(&view).expect("serialize");
    assert!(!json.contains("mcp.example"));
    assert!(!json.contains("fixture-token"));
    assert!(!json.contains("Bearer"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn project_mcp_layers_are_trust_gated_and_nested_layer_wins() {
    let root = fixture("project");
    let project = root.join("project");
    let nested = project.join("src");
    fs::create_dir_all(nested.join(".codex")).expect("nested");
    fs::create_dir_all(project.join(".codex")).expect("project");
    fs::write(
        root.join("config.toml"),
        format!(
            "[projects.\"{}\"]\ntrust_level = \"trusted\"\n",
            project.display()
        ),
    )
    .expect("user");
    fs::write(
        project.join(".codex/config.toml"),
        "[mcp_servers.project]\ncommand = \"root-project\"\n",
    )
    .expect("root layer");
    fs::write(
        nested.join(".codex/config.toml"),
        "[mcp_servers.project]\ncommand = \"nested-project\"\n",
    )
    .expect("nested layer");
    let context = normalize_project_context(
        &project.to_string_lossy(),
        Some(&nested.to_string_lossy()),
        None,
        "codex MCP",
    )
    .expect("context");

    let view = discover_at(
        &root,
        &CodexInventoryScope::Project {
            project_id: "project-1".to_string(),
        },
        Some(&context),
        None,
    )
    .expect("discover");
    let project_server = view
        .servers
        .iter()
        .find(|server| server.name == "project")
        .expect("project server");
    assert!(project_server.command_configured);
    assert_eq!(project_server.source_kind, "project");

    fs::write(
        root.join("config.toml"),
        "[mcp_servers.global]\ncommand = \"safe\"\n",
    )
    .expect("untrusted user config");
    let untrusted = discover_at(
        &root,
        &CodexInventoryScope::Project {
            project_id: "project-1".to_string(),
        },
        Some(&context),
        None,
    )
    .expect("untrusted discover");
    assert!(untrusted
        .servers
        .iter()
        .all(|server| server.name != "project"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn malformed_plugin_mcp_is_diagnostic_only_and_does_not_execute_commands() {
    let root = fixture("malformed");
    let sentinel = root.join("executed");
    write_plugin(
        &root,
        r#"{"name":"broken","mcpServers":".mcp.json"}"#,
        &format!(
            r#"{{"mcpServers":{{"broken":{{"command":"touch","args":["{}"]}}}}}}"#,
            sentinel.display()
        ),
    );
    let package = root.join("plugins/cache/community/browser/1.0.0");
    fs::write(package.join(".mcp.json"), "{ malformed").expect("malformed mcp");

    let view = discover_at(&root, &CodexInventoryScope::Global, None, None).expect("discover");
    assert!(view.servers.is_empty());
    assert!(view
        .summary
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "malformed-plugin-mcp"));
    assert!(!sentinel.exists());
    let json = serde_json::to_string(&view).expect("serialize");
    assert!(!json.contains("touch"));
    assert!(!json.contains("executed"));
    let _ = fs::remove_dir_all(root);
}
