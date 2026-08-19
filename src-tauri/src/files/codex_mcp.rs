//! Read-only inspection of Codex MCP configuration and execution policy.
//!
//! This module parses local TOML/JSON only. It never starts a server, probes a
//! transport, resolves OAuth, or serializes endpoint URLs and credentials.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use toml_edit::{DocumentMut, Item, Value as TomlValue};

use crate::config::codex_context::ResolvedCodexProjectContext;
use crate::files::codex_inventory::{read_bounded_file, MAX_DIAGNOSTICS, MAX_INVENTORY_ITEMS};
use crate::files::codex_plugins::{self, PluginMcpRoot};
use crate::files::codex_redaction::{bounded_display, safe_name};
use crate::files::codex_settings::{self, CodexConfigLayer};
use crate::types::codex_inventory::{CodexInventoryDiagnostic, CodexInventoryScope};
use crate::types::codex_mcp::{
    CodexMcpCheckState, CodexMcpEnabledState, CodexMcpPolicySummary, CodexMcpServerSummary,
    CodexMcpStatusView, CodexMcpTransport,
};

const MAX_MCP_CONFIG_BYTES: usize = 256 * 1024;
const MAX_SERVER_NAME_BYTES: usize = 128;
const MAX_POLICY_NAME_BYTES: usize = 64;
const MAX_TOOL_NAMES: usize = 128;
const MAX_ADVERTISED_TOOLS: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ServerKey {
    owner: Option<String>,
    name: String,
}

#[derive(Debug, Clone)]
struct ServerRecord {
    key: ServerKey,
    plugin_name: Option<String>,
    source_label: String,
    source_kind: String,
    precedence: usize,
    transport: CodexMcpTransport,
    configured: bool,
    enabled: CodexMcpEnabledState,
    command_configured: bool,
    endpoint_configured: bool,
    credentials_configured: bool,
    approval_mode: Option<String>,
    advertised_tool_count: usize,
    enabled_tools: Vec<String>,
    disabled_tools: Vec<String>,
    diagnostics: Vec<CodexInventoryDiagnostic>,
}

#[derive(Debug, Clone, Default)]
struct PolicyOverride {
    enabled: Option<bool>,
    approval_mode: Option<String>,
    enabled_tools: Vec<String>,
    disabled_tools: Vec<String>,
    precedence: usize,
    diagnostics: Vec<CodexInventoryDiagnostic>,
}

#[derive(Debug, Clone, Default)]
struct PolicyState {
    approval_mode: Option<String>,
    approval_precedence: usize,
    sandbox_mode: Option<String>,
    sandbox_precedence: usize,
    hooks_configured: bool,
    source_labels: BTreeSet<String>,
    diagnostics: Vec<CodexInventoryDiagnostic>,
}

pub(crate) fn discover(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&ResolvedCodexProjectContext>,
) -> Result<CodexMcpStatusView, String> {
    discover_at(codex_home, scope, context, Some(Path::new("/etc/codex")))
}

pub(crate) fn discover_at(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&ResolvedCodexProjectContext>,
    system_root: Option<&Path>,
) -> Result<CodexMcpStatusView, String> {
    if !codex_home.is_absolute() {
        return Err("codex MCP: resolved CODEX_HOME must be absolute".to_string());
    }
    let layers =
        codex_settings::load_config_layers_for_scope_at(codex_home, scope, context, system_root)?;
    let plugins = codex_plugins::discover(codex_home, scope, context)?;
    let mut diagnostics = plugins.view.summary.diagnostics.clone();
    let mut policy = PolicyState::default();
    let mut servers = BTreeMap::new();
    let mut policies = BTreeMap::new();

    for layer in &layers {
        diagnostics.extend(layer_diagnostics(layer));
        if !layer.active {
            continue;
        }
        let Some(document) = layer.document.as_ref() else {
            continue;
        };
        parse_toml_layer(layer, document, &mut servers, &mut policies, &mut policy);
    }

    for root in &plugins.mcp_roots {
        parse_plugin_mcp(root, &mut servers, &mut diagnostics);
    }
    apply_policies(&mut servers, &policies);
    for server in servers.values_mut() {
        if server.approval_mode.is_none() {
            server.approval_mode = policy.approval_mode.clone();
        }
    }

    diagnostics.truncate(MAX_DIAGNOSTICS);
    policy.diagnostics.truncate(MAX_DIAGNOSTICS);
    let omitted_count = servers.len().saturating_sub(MAX_INVENTORY_ITEMS);
    let mut rows = Vec::new();
    for (_, server) in servers.into_iter().take(MAX_INVENTORY_ITEMS) {
        rows.push(to_summary(scope, server));
    }
    let mut summary_diagnostics = diagnostics;
    summary_diagnostics.extend(policy.diagnostics.clone());
    summary_diagnostics.truncate(MAX_DIAGNOSTICS);
    Ok(CodexMcpStatusView {
        servers: rows,
        policy: CodexMcpPolicySummary {
            approval_mode: policy.approval_mode,
            sandbox_mode: policy.sandbox_mode,
            hooks_configured: policy.hooks_configured,
            source_labels: policy.source_labels.into_iter().collect(),
            diagnostics: policy.diagnostics,
        },
        summary: crate::types::codex_inventory::CodexInventorySummary {
            scope: scope.clone(),
            scan_limited: omitted_count > 0,
            omitted_count,
            diagnostics: summary_diagnostics,
        },
    })
}

fn parse_toml_layer(
    layer: &CodexConfigLayer,
    document: &DocumentMut,
    servers: &mut BTreeMap<ServerKey, ServerRecord>,
    policies: &mut BTreeMap<(String, String), PolicyOverride>,
    policy: &mut PolicyState,
) {
    policy.source_labels.insert(layer.label.clone());
    if let Some(approval) = item_string(document, "approval_policy").and_then(safe_policy_name) {
        if layer.precedence >= policy.approval_precedence {
            policy.approval_mode = Some(approval);
            policy.approval_precedence = layer.precedence;
        }
    }
    if let Some(sandbox) = item_string(document, "sandbox_mode").and_then(safe_policy_name) {
        if layer.precedence >= policy.sandbox_precedence {
            policy.sandbox_mode = Some(sandbox);
            policy.sandbox_precedence = layer.precedence;
        }
    }
    policy.hooks_configured |= document.get("hooks").is_some();

    if let Some(table) = document.get("mcp_servers").and_then(Item::as_table) {
        for (name, item) in table {
            let Some(name) = safe_server_name(name) else {
                policy.diagnostics.push(simple_diagnostic(
                    "invalid-server-name",
                    "A Codex MCP server name was rejected",
                ));
                continue;
            };
            let record = toml_server_record(layer, &name, item, None);
            replace_server(servers, record);
        }
    }
    let Some(plugins) = document.get("plugins").and_then(Item::as_table) else {
        return;
    };
    for (plugin_name, plugin_item) in plugins {
        let Some(mcp_servers) = plugin_item
            .as_table()
            .and_then(|table| table.get("mcp_servers"))
            .and_then(Item::as_table)
        else {
            continue;
        };
        for (server_name, policy_item) in mcp_servers {
            let Some(server_name) = safe_server_name(server_name) else {
                policy.diagnostics.push(simple_diagnostic(
                    "invalid-server-name",
                    "A Codex plugin MCP server name was rejected",
                ));
                continue;
            };
            let Some(plugin_name) = safe_server_name(plugin_name) else {
                policy.diagnostics.push(simple_diagnostic(
                    "invalid-plugin-name",
                    "A Codex plugin MCP owner name was rejected",
                ));
                continue;
            };
            let mut override_value = policy_override(layer.precedence, policy_item);
            override_value.precedence = layer.precedence;
            policy
                .diagnostics
                .extend(override_value.diagnostics.clone());
            let key = (plugin_name.clone(), server_name.clone());
            let should_replace = policies
                .get(&key)
                .map(|existing| existing.precedence <= layer.precedence)
                .unwrap_or(true);
            if should_replace {
                policies.insert(key, override_value);
            }
        }
    }
}

fn toml_server_record(
    layer: &CodexConfigLayer,
    name: &str,
    item: &Item,
    owner: Option<(String, String)>,
) -> ServerRecord {
    let command_configured = item_string(item, "command").is_some();
    let endpoint_configured = item_string(item, "url").is_some();
    let credentials_configured = ["env", "headers", "http_headers", "auth", "oauth"]
        .iter()
        .any(|key| item_has(item, key));
    let transport = transport_from_values(
        item_string(item, "type"),
        command_configured,
        endpoint_configured,
    );
    let owner_id = owner.as_ref().map(|value| value.0.clone());
    let plugin_name = owner.map(|value| value.1);
    let mut diagnostics = Vec::new();
    let approval_mode = item_string(item, "approval_mode")
        .or_else(|| item_string(item, "default_tools_approval_mode"))
        .and_then(|value| {
            safe_policy_name(value).or_else(|| {
                diagnostics.push(simple_diagnostic(
                    "invalid-approval-mode",
                    "An MCP approval mode was omitted because it is not safe to display",
                ));
                None
            })
        });
    let enabled = item_bool(item, "enabled")
        .map(|enabled| {
            if enabled {
                CodexMcpEnabledState::Enabled
            } else {
                CodexMcpEnabledState::Disabled
            }
        })
        .unwrap_or(CodexMcpEnabledState::Unknown);
    ServerRecord {
        key: ServerKey {
            owner: owner_id,
            name: name.to_string(),
        },
        plugin_name,
        source_label: layer.label.clone(),
        source_kind: layer.kind.clone(),
        precedence: layer.precedence,
        transport,
        configured: true,
        enabled,
        command_configured,
        endpoint_configured,
        credentials_configured,
        approval_mode,
        advertised_tool_count: item_array_len(item, "tools")
            .unwrap_or(0)
            .min(MAX_ADVERTISED_TOOLS),
        enabled_tools: item_string_array(item, "enabled_tools", &mut diagnostics),
        disabled_tools: item_string_array(item, "disabled_tools", &mut diagnostics),
        diagnostics,
    }
}

fn parse_plugin_mcp(
    root: &PluginMcpRoot,
    servers: &mut BTreeMap<ServerKey, ServerRecord>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) {
    let path = root.root.join(&root.relative);
    let bounded = match read_bounded_file(&path, MAX_MCP_CONFIG_BYTES) {
        Ok(value) => value,
        Err(_) => {
            diagnostics.push(simple_diagnostic(
                "unreadable-plugin-mcp",
                "A plugin MCP configuration could not be read",
            ));
            return;
        }
    };
    let value: JsonValue = match serde_json::from_str(&bounded.text) {
        Ok(value) => value,
        Err(_) => {
            diagnostics.push(simple_diagnostic(
                "malformed-plugin-mcp",
                "A plugin MCP configuration is malformed",
            ));
            return;
        }
    };
    let Some(object) = value.as_object() else {
        diagnostics.push(simple_diagnostic(
            "invalid-plugin-mcp",
            "A plugin MCP configuration must be an object",
        ));
        return;
    };
    let servers_object = object
        .get("mcpServers")
        .and_then(JsonValue::as_object)
        .unwrap_or(object);
    for (name, value) in servers_object {
        let Some(name) = safe_server_name(name) else {
            diagnostics.push(simple_diagnostic(
                "invalid-server-name",
                "A plugin MCP server name was rejected",
            ));
            continue;
        };
        let Some(value) = value.as_object() else {
            diagnostics.push(simple_diagnostic(
                "invalid-plugin-server",
                "A plugin MCP server entry must be an object",
            ));
            continue;
        };
        let record = json_server_record(root, &name, value);
        replace_server(servers, record);
    }
}

fn json_server_record(
    root: &PluginMcpRoot,
    name: &str,
    object: &serde_json::Map<String, JsonValue>,
) -> ServerRecord {
    let command_configured = json_string(object, "command").is_some();
    let endpoint_configured = json_string(object, "url").is_some();
    let credentials_configured = ["env", "headers", "httpHeaders", "auth", "oauth"]
        .iter()
        .any(|key| object.get(*key).is_some());
    let transport = transport_from_values(
        json_string(object, "type"),
        command_configured,
        endpoint_configured,
    );
    let mut diagnostics = Vec::new();
    let approval_mode = json_string(object, "approvalMode")
        .or_else(|| json_string(object, "defaultToolsApprovalMode"))
        .and_then(|value| {
            safe_policy_name(value).or_else(|| {
                diagnostics.push(simple_diagnostic(
                    "invalid-approval-mode",
                    "An MCP approval mode was omitted because it is not safe to display",
                ));
                None
            })
        });
    let enabled = object
        .get("enabled")
        .and_then(JsonValue::as_bool)
        .map(|enabled| {
            if enabled {
                CodexMcpEnabledState::Enabled
            } else {
                CodexMcpEnabledState::Disabled
            }
        })
        .unwrap_or(CodexMcpEnabledState::Unknown);
    ServerRecord {
        key: ServerKey {
            owner: Some(root.owner_plugin_id.clone()),
            name: name.to_string(),
        },
        plugin_name: Some(root.owner_plugin_name.clone()),
        source_label: "Plugin-owned MCP config".to_string(),
        source_kind: "plugin".to_string(),
        precedence: 0,
        transport,
        configured: true,
        enabled,
        command_configured,
        endpoint_configured,
        credentials_configured,
        approval_mode,
        advertised_tool_count: object
            .get("tools")
            .and_then(JsonValue::as_array)
            .map(|tools| tools.len().min(MAX_ADVERTISED_TOOLS))
            .unwrap_or(0),
        enabled_tools: json_string_array(object, "enabledTools", &mut diagnostics),
        disabled_tools: json_string_array(object, "disabledTools", &mut diagnostics),
        diagnostics,
    }
}

fn replace_server(servers: &mut BTreeMap<ServerKey, ServerRecord>, record: ServerRecord) {
    let should_replace = servers
        .get(&record.key)
        .map(|existing| existing.precedence <= record.precedence)
        .unwrap_or(true);
    if should_replace {
        servers.insert(record.key.clone(), record);
    }
}

fn apply_policies(
    servers: &mut BTreeMap<ServerKey, ServerRecord>,
    policies: &BTreeMap<(String, String), PolicyOverride>,
) {
    for server in servers.values_mut() {
        let Some(plugin_name) = server.plugin_name.as_ref() else {
            continue;
        };
        let Some(policy) = policies.get(&(plugin_name.clone(), server.key.name.clone())) else {
            continue;
        };
        if let Some(enabled) = policy.enabled {
            server.enabled = if enabled {
                CodexMcpEnabledState::Enabled
            } else {
                CodexMcpEnabledState::Disabled
            };
        }
        if policy.approval_mode.is_some() {
            server.approval_mode = policy.approval_mode.clone();
        }
        if !policy.enabled_tools.is_empty() {
            server.enabled_tools = policy.enabled_tools.clone();
        }
        if !policy.disabled_tools.is_empty() {
            server.disabled_tools = policy.disabled_tools.clone();
        }
    }
}

fn policy_override(precedence: usize, item: &Item) -> PolicyOverride {
    let mut diagnostics = Vec::new();
    PolicyOverride {
        enabled: item_bool(item, "enabled"),
        approval_mode: item_string(item, "default_tools_approval_mode")
            .or_else(|| item_string(item, "approval_mode"))
            .and_then(|value| {
                safe_policy_name(value).or_else(|| {
                    diagnostics.push(simple_diagnostic(
                        "invalid-approval-mode",
                        "An MCP approval mode was omitted because it is not safe to display",
                    ));
                    None
                })
            }),
        enabled_tools: item_string_array(item, "enabled_tools", &mut diagnostics),
        disabled_tools: item_string_array(item, "disabled_tools", &mut diagnostics),
        precedence,
        diagnostics,
    }
}

fn to_summary(scope: &CodexInventoryScope, server: ServerRecord) -> CodexMcpServerSummary {
    CodexMcpServerSummary {
        id: server_id(scope, &server.key),
        name: server.key.name,
        source_label: server.source_label,
        source_kind: server.source_kind,
        plugin_owner_id: server.key.owner,
        transport: server.transport,
        configured: server.configured,
        enabled: server.enabled,
        reachable: CodexMcpCheckState::NotChecked,
        approval_mode: server.approval_mode,
        approval_observed: CodexMcpCheckState::NotChecked,
        observed: CodexMcpCheckState::No,
        command_configured: server.command_configured,
        endpoint_configured: server.endpoint_configured,
        credentials_configured: server.credentials_configured,
        advertised_tool_count: server.advertised_tool_count,
        enabled_tools: server.enabled_tools,
        disabled_tools: server.disabled_tools,
        diagnostics: server.diagnostics,
    }
}

fn layer_diagnostics(layer: &CodexConfigLayer) -> Vec<CodexInventoryDiagnostic> {
    layer
        .diagnostics
        .iter()
        .map(|diagnostic| CodexInventoryDiagnostic {
            severity: diagnostic.severity.clone(),
            code: diagnostic.code.clone(),
            message: bounded_display(&diagnostic.message, 256),
            source_id: Some(layer.id.clone()),
            relative_path: None,
        })
        .collect()
}

fn item_string<'a>(item: &'a impl TomlItemLike, key: &str) -> Option<&'a str> {
    item.table_item(key)
        .and_then(Item::as_value)
        .and_then(TomlValue::as_str)
        .or_else(|| item.inline_item(key))
}

trait TomlItemLike {
    fn table_item(&self, key: &str) -> Option<&Item>;
    fn inline_item(&self, key: &str) -> Option<&str>;
}

impl TomlItemLike for DocumentMut {
    fn table_item(&self, key: &str) -> Option<&Item> {
        self.get(key)
    }

    fn inline_item(&self, _key: &str) -> Option<&str> {
        None
    }
}

impl TomlItemLike for Item {
    fn table_item(&self, key: &str) -> Option<&Item> {
        self.as_table().and_then(|table| table.get(key))
    }

    fn inline_item(&self, key: &str) -> Option<&str> {
        self.as_value()
            .and_then(TomlValue::as_inline_table)
            .and_then(|table| table.get(key))
            .and_then(TomlValue::as_str)
    }
}

fn item_bool(item: &impl TomlItemLike, key: &str) -> Option<bool> {
    item.table_item(key)
        .and_then(Item::as_value)
        .and_then(TomlValue::as_bool)
        .or_else(|| {
            item.inline_item(key).and_then(|value| match value {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            })
        })
}

fn item_has(item: &impl TomlItemLike, key: &str) -> bool {
    item.table_item(key).is_some() || item.inline_item(key).is_some()
}

fn item_array_len(item: &impl TomlItemLike, key: &str) -> Option<usize> {
    item.table_item(key)
        .and_then(Item::as_value)
        .and_then(TomlValue::as_array)
        .map(|array| array.len())
}

fn item_string_array(
    item: &impl TomlItemLike,
    key: &str,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) -> Vec<String> {
    let Some(array) = item
        .table_item(key)
        .and_then(Item::as_value)
        .and_then(TomlValue::as_array)
    else {
        return Vec::new();
    };
    array
        .iter()
        .take(MAX_TOOL_NAMES)
        .filter_map(|value| {
            let value = value.as_str()?;
            match safe_name(value, MAX_POLICY_NAME_BYTES) {
                Some(value) => Some(value),
                None => {
                    diagnostics.push(simple_diagnostic(
                        "invalid-tool-name",
                        "An MCP tool policy name was rejected",
                    ));
                    None
                }
            }
        })
        .collect()
}

fn json_string<'a>(object: &'a serde_json::Map<String, JsonValue>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(JsonValue::as_str)
}

fn json_string_array(
    object: &serde_json::Map<String, JsonValue>,
    key: &str,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) -> Vec<String> {
    let Some(array) = object.get(key).and_then(JsonValue::as_array) else {
        return Vec::new();
    };
    array
        .iter()
        .take(MAX_TOOL_NAMES)
        .filter_map(|value| {
            let value = value.as_str()?;
            match safe_name(value, MAX_POLICY_NAME_BYTES) {
                Some(value) => Some(value),
                None => {
                    diagnostics.push(simple_diagnostic(
                        "invalid-tool-name",
                        "An MCP tool policy name was rejected",
                    ));
                    None
                }
            }
        })
        .collect()
}

fn transport_from_values(
    configured_type: Option<&str>,
    command_configured: bool,
    endpoint_configured: bool,
) -> CodexMcpTransport {
    match configured_type.map(str::to_ascii_lowercase).as_deref() {
        Some("stdio") => CodexMcpTransport::Stdio,
        Some("http") | Some("sse") | Some("streamable-http") => CodexMcpTransport::Http,
        Some(_) => CodexMcpTransport::Unknown,
        None if endpoint_configured => CodexMcpTransport::Http,
        None if command_configured => CodexMcpTransport::Stdio,
        None => CodexMcpTransport::Unknown,
    }
}

fn safe_server_name(value: &str) -> Option<String> {
    safe_name(value, MAX_SERVER_NAME_BYTES)
}

fn safe_policy_name(value: &str) -> Option<String> {
    if value.is_empty()
        || value.len() > MAX_POLICY_NAME_BYTES
        || value.chars().any(char::is_control)
        || value.contains("http://")
        || value.contains("https://")
        || value.to_ascii_lowercase().contains("secret")
        || value.to_ascii_lowercase().contains("token")
    {
        return None;
    }
    Some(bounded_display(value, MAX_POLICY_NAME_BYTES))
}

fn server_id(scope: &CodexInventoryScope, key: &ServerKey) -> String {
    let scope_key = match scope {
        CodexInventoryScope::Global => "global".to_string(),
        CodexInventoryScope::Project { project_id } => format!("project:{project_id}"),
    };
    let mut hasher = Sha256::new();
    hasher.update(b"codex-mcp-v1\0");
    hasher.update(scope_key.as_bytes());
    hasher.update(b"\0");
    if let Some(owner) = &key.owner {
        hasher.update(owner.as_bytes());
    }
    hasher.update(b"\0");
    hasher.update(key.name.as_bytes());
    format!("cdx-mcp-{:x}", hasher.finalize())
}

fn simple_diagnostic(code: &str, message: &str) -> CodexInventoryDiagnostic {
    CodexInventoryDiagnostic {
        severity: "warning".to_string(),
        code: code.to_string(),
        message: message.to_string(),
        source_id: None,
        relative_path: None,
    }
}

#[cfg(test)]
#[path = "codex_mcp_tests.rs"]
mod tests;
