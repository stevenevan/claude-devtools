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

    pub fn with_field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
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
    pub fn available() -> Self {
        Self {
            state: TaskGraphCapabilityState::Available,
            reason: "Codex task graph data is available".to_string(),
            diagnostics: Vec::new(),
        }
    }

    pub fn missing(reason: impl Into<String>) -> Self {
        Self {
            state: TaskGraphCapabilityState::Missing,
            reason: reason.into(),
            diagnostics: Vec::new(),
        }
    }

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
    pub maintenance: crate::types::codex_maintenance::MaintenanceCapabilities,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorPage<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub total_matched: Option<usize>,
    pub scan_limited: bool,
    pub diagnostics: Vec<Diagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<InspectorSessionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorSessionSummary {
    pub session_id: String,
    pub project: String,
    pub transcript_id: String,
    pub turn_count: usize,
    pub event_count: Option<usize>,
    pub counts_complete: bool,
    pub source: SourceKind,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorHistoryEntry {
    pub session_id: Option<String>,
    pub display: String,
    pub project: String,
    pub timestamp: Option<i64>,
    pub pasted_count: usize,
    pub source: SourceKind,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTranscriptMeta {
    pub id: String,
    pub label: String,
    pub size_bytes: u64,
    pub mtime: Option<i64>,
    pub source: SourceKind,
    pub archived: bool,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorEvent {
    pub kind: String,
    pub timestamp: Option<String>,
    pub role: Option<String>,
    pub content: Option<String>,
    pub tool_name: Option<String>,
    pub tool_id: Option<String>,
    pub tool_input_shape: Option<String>,
    pub tool_output_size: Option<usize>,
    pub tool_status: Option<String>,
    pub truncated: bool,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTaskGraphMeta {
    pub id: String,
    pub label: Option<String>,
    pub task_count: usize,
    pub latest_mtime: i64,
    pub source: SourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTaskGraphList {
    pub capability: TaskGraphCapability,
    pub items: Vec<InspectorTaskGraphMeta>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTaskNode {
    pub id: String,
    pub subject: String,
    pub description: String,
    pub active_form: String,
    pub status: String,
    pub blocks: Vec<String>,
    pub blocked_by: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTaskGraphResult {
    pub id: String,
    pub nodes: Vec<InspectorTaskNode>,
    pub capability: TaskGraphCapability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
}
