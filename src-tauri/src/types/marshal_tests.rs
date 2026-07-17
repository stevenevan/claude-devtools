//! Serde-attribute parity tests — the Rust mirror of
//! `internal/domain/marshal_test.go`. Guards the omit-key / emit-null /
//! `[]`-not-null rules that make Rust output byte-parity with Go.

use super::jsonl::{ContentBlock, ImageSource, ToolResultContentValue};
use super::messages::{MessageCategory, ParsedMessage, ParsedMessageContent, TokenUsage};
use crate::testutil::{canon, canon_str};

fn minimal_message() -> ParsedMessage {
    ParsedMessage {
        uuid: "u1".into(),
        parent_uuid: None,
        message_type: "assistant".into(),
        timestamp: "2026-01-01T00:00:00Z".into(),
        role: None,
        content: ParsedMessageContent::Text("hello".into()),
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

#[test]
fn parsed_message_optional_omission() {
    let json = serde_json::to_string(&minimal_message()).unwrap();
    // non-skip optional → present as null
    assert!(json.contains(r#""parentUuid":null"#), "{json}");
    // skip optionals → key absent entirely
    for k in [
        "role", "usage", "model", "cwd", "gitBranch", "agentId", "userType",
        "sourceToolUseID", "sourceToolAssistantUUID", "toolUseResult",
        "isCompactSummary", "requestId", "subtype", "eventData",
    ] {
        assert!(!json.contains(&format!("\"{k}\"")), "skip optional {k} must be omitted: {json}");
    }
    // slices must be [] (constructed as vec![]), not null
    assert!(json.contains(r#""toolCalls":[]"#), "{json}");
    assert!(json.contains(r#""toolResults":[]"#), "{json}");
}

#[test]
fn token_usage_snake_case_cache_null() {
    let u = TokenUsage { input_tokens: 10, output_tokens: 5, ..Default::default() };
    assert_eq!(
        canon(&u),
        canon_str(
            r#"{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":null,"cache_creation_input_tokens":null}"#
        )
    );
}

#[test]
fn content_block_variants() {
    assert_eq!(
        canon(&ContentBlock::Text { text: "hi".into() }),
        canon_str(r#"{"type":"text","text":"hi"}"#)
    );
    assert_eq!(
        canon(&ContentBlock::Thinking { thinking: "t".into(), signature: "s".into() }),
        canon_str(r#"{"type":"thinking","thinking":"t","signature":"s"}"#)
    );
    assert_eq!(
        canon(&ContentBlock::ToolUse {
            id: "id1".into(),
            name: "Read".into(),
            input: serde_json::json!({"a": 1}),
        }),
        canon_str(r#"{"type":"tool_use","id":"id1","name":"Read","input":{"a":1}}"#)
    );
    // tool_result: is_error has no skip → present as null when None
    assert_eq!(
        canon(&ContentBlock::ToolResult {
            tool_use_id: "tu1".into(),
            content: ToolResultContentValue::Text("done".into()),
            is_error: None,
        }),
        canon_str(r#"{"type":"tool_result","tool_use_id":"tu1","content":"done","is_error":null}"#)
    );
    assert_eq!(
        canon(&ContentBlock::Image {
            source: ImageSource {
                source_type: "base64".into(),
                media_type: "image/png".into(),
                data: "AAA".into(),
            },
        }),
        canon_str(r#"{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAA"}}"#)
    );
}

#[test]
fn parsed_message_content_untagged() {
    assert_eq!(canon(&ParsedMessageContent::Text("plain".into())), canon_str(r#""plain""#));
    assert_eq!(
        canon(&ParsedMessageContent::Blocks(vec![ContentBlock::Text { text: "x".into() }])),
        canon_str(r#"[{"type":"text","text":"x"}]"#)
    );
}

#[test]
fn message_category_camel_case() {
    assert_eq!(canon(&MessageCategory::HardNoise), canon_str(r#""hardNoise""#));
    assert_eq!(canon(&MessageCategory::Ai), canon_str(r#""ai""#));
}
