use super::*;

#[test]
fn test_parse_content_string() {
    let val = serde_json::json!("simple text");
    let content = parse_message_content(&val);
    match content {
        ParsedMessageContent::Text(t) => assert_eq!(t, "simple text"),
        _ => panic!("expected text"),
    }
}

#[test]
fn test_parse_content_array_of_blocks() {
    let val = serde_json::json!([
        {"type": "text", "text": "block 1"},
        {"type": "text", "text": "block 2"}
    ]);
    let content = parse_message_content(&val);
    match content {
        ParsedMessageContent::Blocks(blocks) => assert_eq!(blocks.len(), 2),
        _ => panic!("expected blocks"),
    }
}

#[test]
fn test_parse_content_number_falls_back_to_empty() {
    let val = serde_json::json!(42);
    let content = parse_message_content(&val);
    match content {
        ParsedMessageContent::Text(t) => assert!(t.is_empty()),
        _ => panic!("expected empty text fallback"),
    }
}

#[test]
fn test_parse_content_array_skips_unrecognized_blocks() {
    let val = serde_json::json!([
        {"type": "text", "text": "valid"},
        {"type": "totally_unknown", "data": 123}
    ]);
    let content = parse_message_content(&val);
    match content {
        ParsedMessageContent::Blocks(blocks) => assert_eq!(blocks.len(), 1),
        _ => panic!("expected blocks"),
    }
}

#[test]
fn test_parse_usage_basic_counts() {
    let v = serde_json::json!({
        "input_tokens": 100,
        "output_tokens": 50
    });
    let usage = parse_usage(&v);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.cache_read_input_tokens, None);
    assert_eq!(usage.cache_creation_input_tokens, None);
}

#[test]
fn test_parse_usage_with_cache_read() {
    let v = serde_json::json!({
        "input_tokens": 200,
        "output_tokens": 100,
        "cache_read_input_tokens": 10
    });
    let usage = parse_usage(&v);
    assert_eq!(usage.cache_read_input_tokens, Some(10));
}

#[test]
fn test_parse_usage_with_cache_creation() {
    let v = serde_json::json!({
        "input_tokens": 50,
        "output_tokens": 20,
        "cache_creation_input_tokens": 25
    });
    let usage = parse_usage(&v);
    assert_eq!(usage.cache_creation_input_tokens, Some(25));
}

#[test]
fn test_parse_usage_missing_required_fields() {
    let v = serde_json::json!({});
    let usage = parse_usage(&v);
    assert_eq!(usage.input_tokens, 0);
    assert_eq!(usage.output_tokens, 0);
}
