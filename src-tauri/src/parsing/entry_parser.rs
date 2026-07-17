/// Parse a raw JSONL entry into a `ParsedMessage`.
///
/// Content-shape and usage normalization live in `content_normalization`;
/// tool-call/result extraction lives in `tool_extraction`. This file owns
/// the entry-level dispatcher that decides which message kind we're
/// looking at and how to wire those helpers together.
use crate::types::jsonl::RawJsonlEntry;
use crate::types::messages::{ParsedMessage, ParsedMessageContent, SystemEventData};

use super::content_normalization::{parse_message_content, parse_usage};
use super::system_event::build_system_event_data;
use super::tool_extraction::{extract_tool_calls, extract_tool_results};

const KNOWN_TYPES: &[&str] = &[
    "user",
    "assistant",
    "system",
    "summary",
    "file-history-snapshot",
    "queue-operation",
    "progress",
];

/// Returns None for entries without uuid or unknown types.
pub fn parse_entry(entry: &RawJsonlEntry) -> Option<ParsedMessage> {
    if !KNOWN_TYPES.contains(&entry.entry_type.as_str()) {
        return None;
    }

    let uuid = match entry.uuid.as_ref() {
        Some(u) if !u.is_empty() => u.clone(),
        _ => {
            if entry.entry_type == "progress" {
                let tool_id = entry.tool_use_id_ref.as_deref().unwrap_or("unknown");
                let ts = entry.timestamp.as_deref().unwrap_or("0");
                format!("progress-{}-{}", tool_id, ts)
            } else {
                return None;
            }
        }
    };

    let is_conversational = matches!(entry.entry_type.as_str(), "user" | "assistant" | "system");

    let mut content = ParsedMessageContent::Text(String::new());
    let mut role = None;
    let mut usage = None;
    let mut model = None;
    let mut request_id = None;
    let mut is_meta = entry.is_meta.unwrap_or(false);
    let mut is_compact_summary = entry.is_compact_summary.unwrap_or(false);
    let mut subtype: Option<String> = None;
    let mut event_data: Option<SystemEventData> = None;

    if is_conversational {
        if let Some(ref msg_value) = entry.message {
            match entry.entry_type.as_str() {
                "user" => {
                    if let Some(msg_content) = msg_value.get("content") {
                        content = parse_message_content(msg_content);
                    }
                    role = msg_value
                        .get("role")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                "assistant" => {
                    if let Some(msg_content) = msg_value.get("content") {
                        content = parse_message_content(msg_content);
                    }
                    role = msg_value
                        .get("role")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    model = msg_value
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    if let Some(usage_val) = msg_value.get("usage") {
                        usage = Some(parse_usage(usage_val));
                    }

                    request_id = entry.request_id.clone();
                }
                "system" => {
                    is_meta = entry.is_meta.unwrap_or(false);
                    if let Some(ref sub) = entry.subtype {
                        subtype = Some(sub.clone());
                        event_data = build_system_event_data(entry);
                    }
                }
                _ => {}
            }
        }

        if entry.entry_type == "user" {
            if let Some(true) = entry.is_compact_summary {
                is_compact_summary = true;
            }
        }
    }

    if entry.entry_type == "progress" {
        subtype = Some("progress".to_string());
        if let Some(ref data) = entry.data {
            if let Some(msg) = data.get("message").and_then(|v| v.as_str()) {
                content = ParsedMessageContent::Text(msg.to_string());
            }
        }
    }

    if entry.entry_type == "queue-operation" {
        subtype = Some("queue_operation".to_string());
        event_data = Some(SystemEventData {
            subtype: "queue_operation".to_string(),
            operation: entry.operation.clone(),
            queued_content: entry.content.clone(),
            ..Default::default()
        });
    }

    let tool_calls = extract_tool_calls(&content);
    let tool_results = extract_tool_results(&content);

    // Synthetic fallback when an entry lacks a timestamp. Match Go's
    // `time.Now().UTC().Format(time.RFC3339)` (entry_parser.go:111): seconds
    // precision + trailing `Z`. Plain `to_rfc3339()` emits nanos + `+00:00`,
    // which diverges. This field derives from `now()`, so it is never
    // golden-diffed — only the format shape is asserted (see tests).
    let timestamp = entry.timestamp.clone().unwrap_or_else(|| {
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    });

    Some(ParsedMessage {
        uuid: uuid.clone(),
        parent_uuid: if is_conversational {
            entry.parent_uuid.clone()
        } else {
            None
        },
        message_type: entry.entry_type.clone(),
        timestamp,
        role,
        content,
        usage,
        model,
        cwd: entry.cwd.clone(),
        git_branch: entry.git_branch.clone(),
        agent_id: entry.agent_id.clone(),
        is_sidechain: entry.is_sidechain,
        is_meta,
        user_type: entry.user_type.clone(),
        tool_calls,
        tool_results,
        source_tool_use_id: entry.source_tool_use_id.clone(),
        source_tool_assistant_uuid: entry.source_tool_assistant_uuid.clone(),
        tool_use_result: entry.tool_use_result.clone(),
        is_compact_summary: if is_compact_summary { Some(true) } else { None },
        request_id,
        subtype,
        event_data,
    })
}

#[cfg(test)]
#[path = "entry_parser_tests.rs"]
mod entry_tests;

#[cfg(test)]
#[path = "entry_parser_event_tests.rs"]
mod entry_event_tests;
