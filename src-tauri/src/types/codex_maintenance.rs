use serde::{Deserialize, Serialize};

use super::source::{Diagnostic, Provenance, SourceKind, SourceState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaintenanceCapabilityState {
    Available,
    Missing,
    Unsupported,
    Unreadable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceCapability {
    pub state: MaintenanceCapabilityState,
    pub reason: String,
    pub diagnostics: Vec<Diagnostic>,
}

impl MaintenanceCapability {
    pub fn available() -> Self {
        Self {
            state: MaintenanceCapabilityState::Available,
            reason: "Maintenance data is available".to_string(),
            diagnostics: Vec::new(),
        }
    }

    pub fn missing(reason: impl Into<String>) -> Self {
        Self {
            state: MaintenanceCapabilityState::Missing,
            reason: reason.into(),
            diagnostics: Vec::new(),
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            state: MaintenanceCapabilityState::Unsupported,
            reason: reason.into(),
            diagnostics: Vec::new(),
        }
    }

    pub fn unreadable(reason: impl Into<String>) -> Self {
        Self {
            state: MaintenanceCapabilityState::Unreadable,
            reason: reason.into(),
            diagnostics: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceCapabilities {
    pub usage: MaintenanceCapability,
    pub telemetry: MaintenanceCapability,
    pub file_history: MaintenanceCapability,
    pub shell_snapshots: MaintenanceCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMaintenanceStatus {
    pub source_kind: SourceKind,
    pub state: SourceState,
    pub label: String,
    pub revision: Option<String>,
    pub capabilities: MaintenanceCapabilities,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenancePage<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub total_matched: Option<usize>,
    pub scan_limited: bool,
    pub diagnostics: Vec<Diagnostic>,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub source: SourceKind,
    pub state: MaintenanceCapabilityState,
    pub period: Option<String>,
    pub turns: Option<u64>,
    pub tokens: Option<u64>,
    pub cost: Option<f64>,
    pub source_file: Option<String>,
    pub revision: Option<String>,
    pub stale: bool,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryItem {
    pub id: String,
    pub kind: Option<String>,
    pub timestamp: Option<String>,
    pub status: Option<String>,
    pub size_bytes: u64,
    pub mtime: i64,
    pub redaction: String,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryDetail {
    pub item: TelemetryItem,
    pub summary: Vec<SafeField>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeField {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointOriginSummary {
    pub display_path: String,
    pub backup_time: Option<String>,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCheckpointGroup {
    pub source: SourceKind,
    pub session_uuid: String,
    pub file_hash: String,
    pub versions: Vec<u32>,
    pub latest_mtime: i64,
    pub latest_size: i64,
    pub origin: Option<CheckpointOriginSummary>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCheckpointDetail {
    pub source: SourceKind,
    pub session_uuid: String,
    pub file_hash: String,
    pub version: u32,
    pub content: Option<String>,
    pub content_unavailable_reason: Option<String>,
    pub byte_size: usize,
    pub binary: bool,
    pub provenance: Provenance,
    pub revision: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointMutationResult {
    pub operation: String,
    pub state: String,
    pub target_changed: bool,
    pub target_label: Option<String>,
    pub recovery_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSnapshotItem {
    pub name: String,
    pub size_bytes: u64,
    pub mtime: i64,
    pub session_id: Option<String>,
    pub redaction: String,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSnapshotDetail {
    pub item: ShellSnapshotItem,
    pub content: Option<String>,
    pub truncated: bool,
    pub unavailable_reason: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCopy {
    pub id: String,
    pub source: SourceKind,
    pub session_uuid: String,
    pub file_hash: String,
    pub version: u32,
    pub target_label: String,
    pub created_at: i64,
    pub byte_size: u64,
    pub checksum: String,
    pub state: String,
}
