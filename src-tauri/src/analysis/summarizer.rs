//! Lexical session summarizer (sprint 74).
//!
//! Produces a 3-bullet TL;DR with no LLM involvement:
//!   1. First real user prompt, truncated to 120 chars at word boundary.
//!   2. Last AI text response, truncated to 120 chars at word boundary.
//!   3. Top-3 tools by invocation count, format "Read×4, Bash×2, Edit×1".

use std::collections::HashMap;

use serde::Serialize;

use crate::parsing::message_classifier::is_parsed_real_user_message;
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

pub const SUMMARY_TRUNCATE_CHARS: usize = 120;
const TOP_TOOLS: usize = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTldr {
    pub first_user_prompt: Option<String>,
    pub last_ai_response: Option<String>,
    pub tool_summary: String,
}

pub fn build_session_tldr(messages: &[ParsedMessage]) -> SessionTldr {
    SessionTldr {
        first_user_prompt: first_user_prompt(messages),
        last_ai_response: last_ai_response(messages),
        tool_summary: tool_summary(messages),
    }
}

fn first_user_prompt(messages: &[ParsedMessage]) -> Option<String> {
    for msg in messages {
        if is_parsed_real_user_message(msg) {
            let text = extract_text(&msg.content);
            if !text.trim().is_empty() {
                return Some(truncate_at_word_boundary(text.trim(), SUMMARY_TRUNCATE_CHARS));
            }
        }
    }
    None
}

fn last_ai_response(messages: &[ParsedMessage]) -> Option<String> {
    for msg in messages.iter().rev() {
        if msg.message_type == "assistant" {
            let text = extract_text(&msg.content);
            if !text.trim().is_empty() {
                return Some(truncate_at_word_boundary(text.trim(), SUMMARY_TRUNCATE_CHARS));
            }
        }
    }
    None
}

fn tool_summary(messages: &[ParsedMessage]) -> String {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for msg in messages {
        for call in &msg.tool_calls {
            *counts.entry(call.name.clone()).or_insert(0) += 1;
        }
    }
    if counts.is_empty() {
        return "no tool calls".to_string();
    }
    let mut sorted: Vec<(String, u32)> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    sorted
        .into_iter()
        .take(TOP_TOOLS)
        .map(|(name, n)| format!("{name}×{n}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn extract_text(content: &ParsedMessageContent) -> String {
    match content {
        ParsedMessageContent::Text(s) => s.clone(),
        ParsedMessageContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn truncate_at_word_boundary(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let truncated: String = input.chars().take(max_chars).collect();
    match truncated.rfind(char::is_whitespace) {
        Some(idx) if idx > 0 => format!("{}…", &truncated[..idx].trim_end()),
        _ => format!("{}…", truncated.trim_end()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::messages::{ParsedMessage, ParsedMessageContent, ToolCall};

    fn user_msg(text: &str) -> ParsedMessage {
        ParsedMessage {
            uuid: "u".to_string(),
            parent_uuid: None,
            message_type: "user".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some("user".to_string()),
            content: ParsedMessageContent::Text(text.to_string()),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
            is_meta: false,
            user_type: None,
            tool_calls: vec![],
            tool_results: vec![],
            source_tool_use_id: None,
            source_tool_assistant_uuid: None,
            tool_use_result: None,
            is_compact_summary: None,
            request_id: None,
            subtype: None,
            event_data: None,
        }
    }

    fn ai_msg(text: &str) -> ParsedMessage {
        let mut m = user_msg(text);
        m.message_type = "assistant".to_string();
        m.role = Some("assistant".to_string());
        m
    }

    fn ai_with_tool(name: &str) -> ParsedMessage {
        let mut m = ai_msg("");
        m.tool_calls.push(ToolCall {
            id: "tu".to_string(),
            name: name.to_string(),
            input: serde_json::json!({}),
            is_task: false,
            task_description: None,
            task_subagent_type: None,
        });
        m
    }

    #[test]
    fn truncate_at_word_boundary_short() {
        assert_eq!(truncate_at_word_boundary("hi there", 50), "hi there");
    }

    #[test]
    fn truncate_at_word_boundary_long() {
        let s = "The quick brown fox jumps over the lazy dog and lands gracefully";
        let out = truncate_at_word_boundary(s, 20);
        assert!(out.ends_with('…'));
        assert!(!out.contains("dog"));
        // Boundary should fall on a space, not mid-word.
        let no_ellipsis = out.trim_end_matches('…');
        assert!(no_ellipsis.ends_with(|c: char| !c.is_whitespace()));
    }

    #[test]
    fn first_user_prompt_picks_first_real() {
        let messages = vec![user_msg("hello world")];
        let tldr = build_session_tldr(&messages);
        assert_eq!(tldr.first_user_prompt.as_deref(), Some("hello world"));
    }

    #[test]
    fn first_user_prompt_skips_meta() {
        let mut meta = user_msg("internal");
        meta.is_meta = true;
        let real = user_msg("real prompt");
        let tldr = build_session_tldr(&[meta, real]);
        assert_eq!(tldr.first_user_prompt.as_deref(), Some("real prompt"));
    }

    #[test]
    fn last_ai_response_picks_latest() {
        let messages = vec![
            user_msg("hi"),
            ai_msg("first reply"),
            user_msg("again"),
            ai_msg("final reply"),
        ];
        let tldr = build_session_tldr(&messages);
        assert_eq!(tldr.last_ai_response.as_deref(), Some("final reply"));
    }

    #[test]
    fn tool_summary_top_three_format() {
        let messages = vec![
            ai_with_tool("Read"),
            ai_with_tool("Read"),
            ai_with_tool("Bash"),
            ai_with_tool("Read"),
            ai_with_tool("Edit"),
            ai_with_tool("Bash"),
            ai_with_tool("Read"),
        ];
        let tldr = build_session_tldr(&messages);
        assert_eq!(tldr.tool_summary, "Read×4, Bash×2, Edit×1");
    }

    #[test]
    fn tool_summary_empty() {
        let tldr = build_session_tldr(&[user_msg("hi")]);
        assert_eq!(tldr.tool_summary, "no tool calls");
    }
}
