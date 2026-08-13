use serde::{Deserialize, Serialize};

/// A local inspector data source. The values are part of the renderer IPC
/// contract, so keep them stable and lowercase on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Claude,
    Codex,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceState {
    Available,
    NotFound,
    Invalid,
    Unreadable,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskGraphCapabilityState {
    Available,
    Missing,
    UnsupportedCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

impl Diagnostic {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            line: None,
            field: None,
        }
    }

    pub fn at_line(mut self, line: usize) -> Self {
        self.line = Some(line);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGraphCapability {
    pub state: TaskGraphCapabilityState,
    pub reason: String,
    pub diagnostics: Vec<Diagnostic>,
}

impl TaskGraphCapability {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            state: TaskGraphCapabilityState::UnsupportedCapability,
            reason: reason.into(),
            diagnostics: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCapabilities {
    pub sessions: bool,
    pub transcripts: bool,
    pub task_graph: TaskGraphCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub source_kind: SourceKind,
    pub state: SourceState,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub capabilities: SourceCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub source_file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    pub archived: bool,
}
