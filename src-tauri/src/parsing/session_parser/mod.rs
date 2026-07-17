/// Full session file parsing — composes streaming/incremental readers
/// with the per-message categorization helpers from `parsing::content_type`
/// and `parsing::category_rules`.
///
/// The submodules `streaming` and `incremental` host the byte-level work;
/// this file owns the `process_messages` orchestrator and the
/// `parse_session_file` entry point used by the Tauri command layer.
pub mod incremental;
pub mod streaming;

use std::path::Path;

use crate::types::domain::{MessagesByType, ParsedSession};
use crate::types::messages::{ParsedMessage, ToolCall};

use super::content_type::is_parsed_real_user_message;
use super::metrics::calculate_metrics;

pub use incremental::parse_jsonl_incremental;
pub use streaming::{
    LineParseResult, MAX_JSONL_LINE_BYTES, SessionFileMetadata, parse_jsonl_file, parse_jsonl_line,
};

pub fn process_messages(
    messages: Vec<ParsedMessage>,
    metadata: SessionFileMetadata,
) -> ParsedSession {
    let metrics = calculate_metrics(&messages);
    let task_calls = get_task_calls(&messages);

    let mut by_type = MessagesByType {
        user: Vec::new(),
        real_user: Vec::new(),
        internal_user: Vec::new(),
        assistant: Vec::new(),
        system: Vec::new(),
        other: Vec::new(),
    };

    let mut sidechain_messages = Vec::new();
    let mut main_messages = Vec::new();

    for msg in &messages {
        match msg.message_type.as_str() {
            "user" => {
                by_type.user.push(msg.clone());
                if is_parsed_real_user_message(msg) {
                    by_type.real_user.push(msg.clone());
                }
                if msg.is_meta {
                    by_type.internal_user.push(msg.clone());
                }
            }
            "assistant" => by_type.assistant.push(msg.clone()),
            "system" => by_type.system.push(msg.clone()),
            _ => by_type.other.push(msg.clone()),
        }

        if msg.is_sidechain {
            sidechain_messages.push(msg.clone());
        } else {
            main_messages.push(msg.clone());
        }
    }

    ParsedSession {
        messages,
        metrics,
        task_calls,
        by_type,
        sidechain_messages,
        main_messages,
        custom_title: metadata.custom_title,
        agent_name: metadata.agent_name,
    }
}

fn get_task_calls(messages: &[ParsedMessage]) -> Vec<ToolCall> {
    messages
        .iter()
        .flat_map(|m| m.tool_calls.iter().filter(|tc| tc.is_task).cloned())
        .collect()
}

pub fn parse_session_file(file_path: &Path) -> Result<ParsedSession, String> {
    let (messages, metadata) = parse_jsonl_file(file_path)?;
    Ok(process_messages(messages, metadata))
}

#[cfg(test)]
#[path = "orchestrator_tests.rs"]
mod tests;
