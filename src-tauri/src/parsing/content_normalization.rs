/// Helpers that normalize the heterogeneous content shapes inside a
/// `RawJsonlEntry.message` field into the canonical `ParsedMessageContent`
/// + `TokenUsage` values used by the rest of the pipeline.
use serde_json::Value;

use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessageContent, TokenUsage};

/// Parse message content from a JSON value into `ParsedMessageContent`.
///
/// Strings become `Text`, arrays become `Blocks` (unrecognized block
/// variants are skipped), and any other JSON shape collapses to an empty
/// `Text` so downstream callers always get a usable value.
pub fn parse_message_content(value: &Value) -> ParsedMessageContent {
    match value {
        Value::String(s) => ParsedMessageContent::Text(s.clone()),
        Value::Array(arr) => {
            let blocks: Vec<ContentBlock> = arr
                .iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect();
            ParsedMessageContent::Blocks(blocks)
        }
        _ => ParsedMessageContent::Text(String::new()),
    }
}

/// Parse the `usage` object on an assistant message into a `TokenUsage`.
pub fn parse_usage(usage_val: &Value) -> TokenUsage {
    TokenUsage {
        input_tokens: usage_val
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        output_tokens: usage_val
            .get("output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        cache_read_input_tokens: usage_val.get("cache_read_input_tokens").and_then(|v| v.as_u64()),
        cache_creation_input_tokens: usage_val
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64()),
    }
}

#[cfg(test)]
#[path = "content_normalization_tests.rs"]
mod tests;
