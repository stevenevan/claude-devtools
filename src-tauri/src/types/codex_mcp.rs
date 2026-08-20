//! Renderer-safe contracts for local Codex MCP configuration inspection.

use serde::{Deserialize, Serialize};

use super::codex_inventory::{CodexInventoryDiagnostic, CodexInventorySummary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexMcpTransport {
    Stdio,
    Http,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexMcpEnabledState {
    Enabled,
    Disabled,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexMcpCheckState {
    NotChecked,
    Yes,
    No,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMcpServerSummary {
    pub id: String,
    pub name: String,
    pub source_label: String,
    pub source_kind: String,
    pub plugin_owner_id: Option<String>,
    pub transport: CodexMcpTransport,
    pub configured: bool,
    pub enabled: CodexMcpEnabledState,
    pub reachable: CodexMcpCheckState,
    pub approval_mode: Option<String>,
    pub approval_observed: CodexMcpCheckState,
    pub observed: CodexMcpCheckState,
    pub command_configured: bool,
    pub endpoint_configured: bool,
    pub credentials_configured: bool,
    pub advertised_tool_count: usize,
    pub enabled_tools: Vec<String>,
    pub disabled_tools: Vec<String>,
    pub diagnostics: Vec<CodexInventoryDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMcpPolicySummary {
    pub approval_mode: Option<String>,
    pub sandbox_mode: Option<String>,
    pub hooks_configured: bool,
    pub source_labels: Vec<String>,
    pub diagnostics: Vec<CodexInventoryDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMcpStatusView {
    pub servers: Vec<CodexMcpServerSummary>,
    pub policy: CodexMcpPolicySummary,
    pub summary: CodexInventorySummary,
}
