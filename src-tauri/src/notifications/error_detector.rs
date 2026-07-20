//! `error_detector` — orchestrates trigger matching across a session's parsed
//! messages. Ported from `internal/notifications/error_detector.go` (W14).

use std::collections::HashMap;

use crate::config::state::types::NotificationTrigger;
use crate::types::messages::ParsedMessage;

use super::checks::{
    check_token_threshold_trigger, check_tool_result_trigger, check_tool_use_trigger,
};
use super::tool_maps::{build_tool_result_map, build_tool_use_map, ToolResultInfo, ToolUseInfo};
use super::types::DetectedError;

/// Whether a project ID is covered by the trigger's `repositoryIds` scope.
/// Nil/empty scope means "all repositories".
fn matches_repository_scope(project_id: &str, repository_ids: Option<&[String]>) -> bool {
    match repository_ids {
        Some(ids) if !ids.is_empty() => ids.iter().any(|id| id == project_id),
        _ => true,
    }
}

/// Routes one trigger against one message to the appropriate checker.
#[allow(clippy::too_many_arguments)]
fn check_trigger(
    msg: &ParsedMessage,
    trigger: &NotificationTrigger,
    tool_use_map: &HashMap<String, ToolUseInfo>,
    tool_result_map: &HashMap<String, ToolResultInfo>,
    session_id: &str,
    project_id: &str,
    file_path: &str,
    line_number: u32,
) -> Vec<DetectedError> {
    if !matches_repository_scope(project_id, trigger.repository_ids.as_deref()) {
        return Vec::new();
    }

    if trigger.mode == "token_threshold" {
        return check_token_threshold_trigger(
            msg,
            trigger,
            tool_result_map,
            session_id,
            project_id,
            file_path,
            line_number,
        );
    }

    if trigger.content_type == "tool_result" {
        return check_tool_result_trigger(
            msg,
            trigger,
            tool_use_map,
            session_id,
            project_id,
            file_path,
            line_number,
        )
        .into_iter()
        .collect();
    }

    if trigger.content_type == "tool_use" {
        return check_tool_use_trigger(msg, trigger, session_id, project_id, file_path, line_number)
            .into_iter()
            .collect();
    }

    Vec::new()
}

/// Runs all triggers against every message in the session.
pub fn detect_errors(
    messages: &[ParsedMessage],
    session_id: &str,
    project_id: &str,
    file_path: &str,
    triggers: &[NotificationTrigger],
) -> Vec<DetectedError> {
    if triggers.is_empty() {
        return Vec::new();
    }

    let tool_use_map = build_tool_use_map(messages);
    let tool_result_map = build_tool_result_map(messages);
    let mut errors = Vec::new();

    for (i, msg) in messages.iter().enumerate() {
        let line_number = (i + 1) as u32;
        for trigger in triggers {
            errors.extend(check_trigger(
                msg,
                trigger,
                &tool_use_map,
                &tool_result_map,
                session_id,
                project_id,
                file_path,
                line_number,
            ));
        }
    }

    errors
}

/// Runs a single trigger against a session's messages.
pub fn detect_errors_with_trigger(
    messages: &[ParsedMessage],
    trigger: &NotificationTrigger,
    session_id: &str,
    project_id: &str,
    file_path: &str,
) -> Vec<DetectedError> {
    detect_errors(
        messages,
        session_id,
        project_id,
        file_path,
        std::slice::from_ref(trigger),
    )
}

#[cfg(test)]
#[path = "error_detector_tests.rs"]
mod tests;
