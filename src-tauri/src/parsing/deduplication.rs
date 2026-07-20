/// Streaming deduplication for assistant entries by requestId.

use std::collections::HashMap;

use crate::types::messages::ParsedMessage;

/// Deduplicate streaming assistant entries by requestId.
///
/// Claude Code writes multiple JSONL entries per API response during streaming,
/// each with the same requestId but incrementally increasing output_tokens.
/// Only the last entry per requestId has the final, complete token counts.
///
/// Messages without a requestId pass through unchanged.
pub fn deduplicate_by_request_id(messages: &[ParsedMessage]) -> Vec<ParsedMessage> {
    // Map from requestId → index of last occurrence
    let mut last_index: HashMap<&str, usize> = HashMap::new();

    for (i, msg) in messages.iter().enumerate() {
        if let Some(ref rid) = msg.request_id {
            last_index.insert(rid.as_str(), i);
        }
    }

    // If no requestIds found, no dedup needed
    if last_index.is_empty() {
        return messages.to_vec();
    }

    messages
        .iter()
        .enumerate()
        .filter(|(i, msg)| {
            match &msg.request_id {
                Some(rid) => last_index.get(rid.as_str()) == Some(i),
                None => true, // Keep messages without requestId
            }
        })
        .map(|(_, msg)| msg.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::messages::{ParsedMessageContent, TokenUsage};

    fn make_msg(uuid: &str, request_id: Option<&str>, output_tokens: u64) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: "assistant".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some("assistant".to_string()),
            content: ParsedMessageContent::Text("test".to_string()),
            usage: Some(TokenUsage {
                input_tokens: 100,
                output_tokens,
                cache_read_input_tokens: None,
                cache_creation_input_tokens: None,
            }),
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
            request_id: request_id.map(|s| s.to_string()),
            subtype: None,
            event_data: None,
        }
    }

    #[test]
    fn test_dedup_keeps_last_per_request_id() {
        let msgs = vec![
            make_msg("a1", Some("req1"), 10),
            make_msg("a2", Some("req1"), 20),
            make_msg("a3", Some("req1"), 30),
        ];
        let deduped = deduplicate_by_request_id(&msgs);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].uuid, "a3");
    }

    #[test]
    fn test_dedup_passes_through_no_request_id() {
        let msgs = vec![
            make_msg("u1", None, 0),
            make_msg("a1", Some("req1"), 10),
            make_msg("a2", Some("req1"), 20),
            make_msg("u2", None, 0),
        ];
        let deduped = deduplicate_by_request_id(&msgs);
        assert_eq!(deduped.len(), 3);
        assert_eq!(deduped[0].uuid, "u1");
        assert_eq!(deduped[1].uuid, "a2");
        assert_eq!(deduped[2].uuid, "u2");
    }

    #[test]
    fn test_dedup_no_request_ids_returns_all() {
        let msgs = vec![make_msg("u1", None, 0), make_msg("u2", None, 0)];
        let deduped = deduplicate_by_request_id(&msgs);
        assert_eq!(deduped.len(), 2);
    }
}
