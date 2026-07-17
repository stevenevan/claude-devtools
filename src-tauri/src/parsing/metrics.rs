/// Session metrics calculation from parsed messages.

use crate::types::domain::SessionMetrics;
use crate::types::messages::ParsedMessage;

use super::deduplication::deduplicate_by_request_id;

/// Deduplicates streaming entries by requestId before summing to avoid overcounting.
pub fn calculate_metrics(messages: &[ParsedMessage]) -> SessionMetrics {
    if messages.is_empty() {
        return SessionMetrics::default();
    }

    let deduped = deduplicate_by_request_id(messages);

    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_read_tokens: u64 = 0;
    let mut cache_creation_tokens: u64 = 0;

    for msg in &deduped {
        if let Some(ref usage) = msg.usage {
            input_tokens += usage.input_tokens;
            output_tokens += usage.output_tokens;
            cache_read_tokens += usage.cache_read_input_tokens.unwrap_or(0);
            cache_creation_tokens += usage.cache_creation_input_tokens.unwrap_or(0);
        }
    }

    // Calculate duration from timestamp range
    let timestamps: Vec<i64> = messages
        .iter()
        .filter_map(|m| chrono::DateTime::parse_from_rfc3339(&m.timestamp).ok())
        .map(|dt| dt.timestamp_millis())
        .collect();

    let duration_ms = if timestamps.len() >= 2 {
        let min = *timestamps.iter().min().unwrap();
        let max = *timestamps.iter().max().unwrap();
        (max - min) as f64
    } else {
        0.0
    };

    // Extract primary model (most frequent non-synthetic assistant model)
    let model = extract_primary_model(messages);

    SessionMetrics {
        duration_ms,
        total_tokens: input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        message_count: messages.len() as u32,
        cost_usd: None,
        model,
    }
}

fn extract_primary_model(messages: &[ParsedMessage]) -> Option<String> {
    use std::collections::HashMap;
    let mut counts: HashMap<&str, u32> = HashMap::new();

    for msg in messages {
        if msg.message_type == "assistant" {
            if let Some(ref model) = msg.model {
                if !model.is_empty() && model != "<synthetic>" {
                    *counts.entry(model.as_str()).or_insert(0) += 1;
                }
            }
        }
    }

    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(model, _)| model.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::messages::{ParsedMessageContent, TokenUsage};

    fn make_msg(uuid: &str, ts: &str, usage: Option<TokenUsage>) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: "assistant".to_string(),
            timestamp: ts.to_string(),
            role: Some("assistant".to_string()),
            content: ParsedMessageContent::Text("test".to_string()),
            usage,
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

    #[test]
    fn test_empty_messages() {
        let metrics = calculate_metrics(&[]);
        assert_eq!(metrics.total_tokens, 0);
        assert_eq!(metrics.message_count, 0);
    }

    #[test]
    fn test_sum_tokens() {
        let msgs = vec![
            make_msg(
                "a1",
                "2024-01-01T00:00:00Z",
                Some(TokenUsage {
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_read_input_tokens: Some(10),
                    cache_creation_input_tokens: Some(5),
                }),
            ),
            make_msg(
                "a2",
                "2024-01-01T00:01:00Z",
                Some(TokenUsage {
                    input_tokens: 200,
                    output_tokens: 100,
                    cache_read_input_tokens: None,
                    cache_creation_input_tokens: None,
                }),
            ),
        ];
        let metrics = calculate_metrics(&msgs);
        assert_eq!(metrics.input_tokens, 300);
        assert_eq!(metrics.output_tokens, 150);
        assert_eq!(metrics.cache_read_tokens, 10);
        assert_eq!(metrics.cache_creation_tokens, 5);
        assert_eq!(metrics.total_tokens, 465);
        assert_eq!(metrics.message_count, 2);
        assert_eq!(metrics.duration_ms, 60000.0);
    }
}
