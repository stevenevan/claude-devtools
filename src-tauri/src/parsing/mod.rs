pub mod category_rules;
pub mod content_type;
pub mod deduplication;
pub mod entry_parser;
pub mod message_classifier;
pub mod metrics;
pub mod session_parser;
pub mod system_event;
pub mod tool_extraction;

#[cfg(test)]
pub(crate) mod test_support {
    use crate::types::jsonl::ContentBlock;
    use crate::types::messages::{ParsedMessage, ParsedMessageContent};

    pub fn make_user_msg(content: &str, is_meta: bool) -> ParsedMessage {
        ParsedMessage {
            uuid: "u1".to_string(),
            parent_uuid: None,
            message_type: "user".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some("user".to_string()),
            content: ParsedMessageContent::Text(content.to_string()),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
            is_meta,
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

    pub fn make_blocks_msg(blocks: Vec<ContentBlock>, is_meta: bool) -> ParsedMessage {
        ParsedMessage {
            uuid: "u1".to_string(),
            parent_uuid: None,
            message_type: "user".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some("user".to_string()),
            content: ParsedMessageContent::Blocks(blocks),
            usage: None,
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
            is_meta,
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
}
