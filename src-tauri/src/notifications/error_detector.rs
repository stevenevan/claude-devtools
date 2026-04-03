/// ErrorDetector — orchestrates error detection from parsed messages.

use std::collections::HashMap;

use crate::config::types::NotificationTrigger;
use crate::types::messages::ParsedMessage;

use super::trigger_checker::{
    build_tool_result_map, build_tool_use_map, check_token_threshold_trigger,
    check_tool_result_trigger, check_tool_use_trigger, ToolResultInfo, ToolUseInfo,
};
use super::types::DetectedError;

// Repository Scope

/// Simplified repository scope check: treats repositoryIds as project ID matching.
/// Full git identity resolution deferred to a future sprint.
fn matches_repository_scope(project_id: &str, repository_ids: Option<&[String]>) -> bool {
    match repository_ids {
        None => true,
        Some(ids) if ids.is_empty() => true,
        Some(ids) => ids.iter().any(|id| id == project_id),
    }
}

// Trigger Router

fn check_trigger(
    message: &ParsedMessage,
    trigger: &NotificationTrigger,
    tool_use_map: &HashMap<String, ToolUseInfo>,
    tool_result_map: &HashMap<String, ToolResultInfo>,
    session_id: &str,
    project_id: &str,
    file_path: &str,
    line_number: u32,
) -> Vec<DetectedError> {
    if !matches_repository_scope(project_id, trigger.repository_ids.as_deref()) {
        return vec![];
    }

    // Token threshold mode
    if trigger.mode == "token_threshold" {
        return check_token_threshold_trigger(
            message,
            trigger,
            tool_result_map,
            session_id,
            project_id,
            file_path,
            line_number,
        );
    }

    // Tool result trigger
    if trigger.content_type == "tool_result" {
        return check_tool_result_trigger(
            message,
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

    // Tool use trigger
    if trigger.content_type == "tool_use" {
        return check_tool_use_trigger(
            message, trigger, session_id, project_id, file_path, line_number,
        )
        .into_iter()
        .collect();
    }

    vec![]
}

// Main Detection

/// Detect errors from messages using the provided triggers.
pub fn detect_errors(
    messages: &[ParsedMessage],
    session_id: &str,
    project_id: &str,
    file_path: &str,
    triggers: &[NotificationTrigger],
) -> Vec<DetectedError> {
    if triggers.is_empty() {
        return vec![];
    }

    let tool_use_map = build_tool_use_map(messages);
    let tool_result_map = build_tool_result_map(messages);
    let mut errors = Vec::new();

    for (i, message) in messages.iter().enumerate() {
        let line_number = (i + 1) as u32;
        for trigger in triggers {
            let trigger_errors = check_trigger(
                message,
                trigger,
                &tool_use_map,
                &tool_result_map,
                session_id,
                project_id,
                file_path,
                line_number,
            );
            errors.extend(trigger_errors);
        }
    }

    errors
}

/// Detect errors using a single trigger (used by trigger tester).
pub fn detect_errors_with_trigger(
    messages: &[ParsedMessage],
    trigger: &NotificationTrigger,
    session_id: &str,
    project_id: &str,
    file_path: &str,
) -> Vec<DetectedError> {
    detect_errors(messages, session_id, project_id, file_path, &[trigger.clone()])
}
