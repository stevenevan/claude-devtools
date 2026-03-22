/// Notification types — DetectedError, StoredNotification, and related structs.

use serde::{Deserialize, Serialize};

// =============================================================================
// DetectedError
// =============================================================================

/// Represents a detected error from a Claude Code session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedError {
    pub id: String,
    pub timestamp: f64,
    pub session_id: String,
    pub project_id: String,
    pub file_path: String,
    pub source: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_name: Option<String>,
    pub context: ErrorContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorContext {
    pub project_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

// =============================================================================
// StoredNotification
// =============================================================================

/// A notification stored to disk (DetectedError + read status).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredNotification {
    #[serde(flatten)]
    pub error: DetectedError,
    pub is_read: bool,
    pub created_at: f64,
}

// =============================================================================
// GetNotificationsResult
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetNotificationsResult {
    pub notifications: Vec<StoredNotification>,
    pub total: usize,
    pub total_count: usize,
    pub unread_count: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetNotificationsOptions {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

// =============================================================================
// TriggerTestResult
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerTestResult {
    pub total_count: usize,
    pub errors: Vec<DetectedError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

// =============================================================================
// CreateDetectedErrorParams
// =============================================================================

pub struct CreateDetectedErrorParams {
    pub session_id: String,
    pub project_id: String,
    pub file_path: String,
    pub project_name: String,
    pub line_number: u32,
    pub source: String,
    pub message: String,
    pub timestamp_ms: f64,
    pub cwd: Option<String>,
    pub tool_use_id: Option<String>,
    pub subagent_id: Option<String>,
    pub trigger_color: Option<String>,
    pub trigger_id: Option<String>,
    pub trigger_name: Option<String>,
}

/// Truncates a message to `max_len` characters.
fn truncate_message(message: &str, max_len: usize) -> String {
    if message.len() <= max_len {
        message.to_string()
    } else {
        format!("{}...", &message[..max_len])
    }
}

/// Creates a DetectedError with a fresh UUID.
pub fn create_detected_error(params: CreateDetectedErrorParams) -> DetectedError {
    DetectedError {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: params.timestamp_ms,
        session_id: params.session_id,
        project_id: params.project_id,
        file_path: params.file_path,
        source: params.source,
        message: truncate_message(&params.message, 500),
        line_number: Some(params.line_number),
        tool_use_id: params.tool_use_id,
        subagent_id: params.subagent_id,
        trigger_color: params.trigger_color,
        trigger_id: params.trigger_id,
        trigger_name: params.trigger_name,
        context: ErrorContext {
            project_name: params.project_name,
            cwd: params.cwd,
        },
    }
}

// =============================================================================
// NotificationUpdated event payload
// =============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationUpdatedPayload {
    pub total: usize,
    pub unread_count: usize,
}
