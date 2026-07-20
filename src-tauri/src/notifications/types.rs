//! Types, rule DSL, and factory helpers ported from
//! `internal/notifications/types.go`. JSON matches serde
//! `rename_all = "camelCase"`; `omitempty` → `skip_serializing_if`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── DetectedError ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorContext {
    pub project_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

// ── StoredNotification ─────────────────────────────────────────────────────

/// `#[serde(flatten)]` lifts every `DetectedError` field to the top level
/// alongside `isRead`/`createdAt` (mirrors the Go embedded struct).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredNotification {
    #[serde(flatten)]
    pub error: DetectedError,
    pub is_read: bool,
    pub created_at: f64,
}

// ── Result types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetNotificationsResult {
    pub notifications: Vec<StoredNotification>,
    pub total: i64,
    pub total_count: i64,
    pub unread_count: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetNotificationsOptions {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerTestResult {
    pub total_count: i64,
    pub errors: Vec<DetectedError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationUpdatedPayload {
    pub total: i64,
    pub unread_count: i64,
}

// ── CreateDetectedErrorParams ──────────────────────────────────────────────

/// Internal factory input — not serialized.
#[derive(Debug, Clone, Default)]
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

const MAX_MESSAGE_LEN: usize = 500;

fn truncate_message(msg: &str, max_len: usize) -> String {
    if msg.len() <= max_len {
        return msg.to_string();
    }
    let mut end = max_len;
    while !msg.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &msg[..end])
}

/// Builds a `DetectedError` with a fresh UUID.
pub fn create_detected_error(p: CreateDetectedErrorParams) -> DetectedError {
    DetectedError {
        id: Uuid::new_v4().to_string(),
        timestamp: p.timestamp_ms,
        session_id: p.session_id,
        project_id: p.project_id,
        file_path: p.file_path,
        source: p.source,
        message: truncate_message(&p.message, MAX_MESSAGE_LEN),
        line_number: Some(p.line_number),
        tool_use_id: p.tool_use_id,
        subagent_id: p.subagent_id,
        trigger_color: p.trigger_color,
        trigger_id: p.trigger_id,
        trigger_name: p.trigger_name,
        context: ErrorContext {
            project_name: p.project_name,
            cwd: p.cwd,
        },
    }
}

// ── Rule DSL ───────────────────────────────────────────────────────────────
// Discriminated unions tagged on `kind` (serde `tag = "kind"`).

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RulePredicate {
    ToolName {
        equals: String,
    },
    DurationGt {
        ms: f64,
    },
    Error {
        #[serde(rename = "isError")]
        is_error: bool,
    },
    CostGt {
        usd: f64,
    },
    RegexMatch {
        pattern: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RuleNode {
    All { children: Vec<RuleNode> },
    Any { children: Vec<RuleNode> },
    Predicate { predicate: RulePredicate },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RuleAction {
    Notify,
    Webhook {
        url: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        template: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub condition: RuleNode,
    pub action: RuleAction,
}

/// Pure data bag consumed by the rule matcher — no JSON serialization.
#[derive(Debug, Clone, Default)]
pub struct RuleEvalContext {
    pub tool_name: Option<String>,
    pub duration_ms: Option<f64>,
    pub is_error: bool,
    pub cost_usd: Option<f64>,
    pub message: Option<String>,
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
