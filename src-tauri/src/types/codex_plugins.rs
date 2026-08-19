//! Renderer-safe contracts for local Codex plugin and marketplace inventory.

use serde::{Deserialize, Serialize};

use super::codex_inventory::{CodexEnabledState, CodexInventoryDiagnostic, CodexInventorySummary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexPluginState {
    Installed,
    Available,
    Disabled,
    Invalid,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexPluginCapabilityKind {
    Skill,
    McpServer,
    App,
    Hook,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginSource {
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginCapability {
    pub kind: CodexPluginCapabilityKind,
    pub name: String,
    pub owner_plugin_id: String,
    pub linked_record_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginSummary {
    pub id: String,
    pub name: String,
    pub display_name: Option<String>,
    pub description: String,
    pub version: Option<String>,
    pub state: CodexPluginState,
    pub enabled_state: CodexEnabledState,
    pub source: CodexPluginSource,
    pub capabilities: Vec<CodexPluginCapability>,
    pub diagnostics: Vec<CodexInventoryDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginList {
    pub items: Vec<CodexPluginSummary>,
    pub summary: CodexInventorySummary,
}
