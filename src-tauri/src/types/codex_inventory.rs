//! Shared, renderer-safe contracts for the Codex instructions, agents, and
//! skills inventory.

use serde::{Deserialize, Serialize};

/// The only scopes accepted by Codex inventory commands. A project scope is
/// identified by the backend-issued project id; the renderer never supplies a
/// filesystem path.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CodexInventoryScope {
    Global,
    Project { project_id: String },
}

impl CodexInventoryScope {
    pub fn is_global(&self) -> bool {
        matches!(self, Self::Global)
    }

    pub fn project_id(&self) -> Option<&str> {
        match self {
            Self::Global => None,
            Self::Project { project_id } => Some(project_id),
        }
    }
}

/// A source identity is stable for a given scope and relative record path.
/// It deliberately excludes content and revision so a file edit does not
/// change the renderer's selection identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSourceIdentity {
    pub id: String,
    pub scope: CodexInventoryScope,
    pub relative_path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInventoryDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub source_id: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInventorySummary {
    pub scope: CodexInventoryScope,
    pub scan_limited: bool,
    pub omitted_count: usize,
    pub diagnostics: Vec<CodexInventoryDiagnostic>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexRecordKind {
    Instruction,
    Agent,
    Skill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexValidationState {
    Valid,
    Missing,
    Malformed,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexEnabledState {
    Enabled,
    Disabled,
    Inherited,
    Unknown,
}

/// Display-only metadata for a declared capability. The inspector does not
/// resolve or execute these names.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUnresolvedCapability {
    pub name: String,
    pub kind: String,
    pub resolved: bool,
}
