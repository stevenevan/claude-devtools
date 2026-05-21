use super::extraction::get_tool_summary;
use super::tokens::{estimate_tokens, format_tokens, parse_timestamp_ms};

#[test]
fn test_estimate_tokens() {
    assert_eq!(estimate_tokens(""), 0);
    assert_eq!(estimate_tokens("abcd"), 1);
    assert_eq!(estimate_tokens("abcde"), 2);
    assert_eq!(estimate_tokens("abcdefgh"), 2);
}

#[test]
fn test_format_tokens() {
    assert_eq!(format_tokens(500), "500");
    assert_eq!(format_tokens(1500), "1.5k");
    assert_eq!(format_tokens(15000), "15k");
}

#[test]
fn test_parse_timestamp_ms() {
    let ts = "2024-01-15T10:30:00Z";
    let ms = parse_timestamp_ms(ts);
    assert!(ms > 0.0);
}

#[test]
fn test_get_tool_summary_read() {
    let input = serde_json::json!({"file_path": "/Users/me/project/src/main.rs"});
    assert_eq!(get_tool_summary("Read", &input), "main.rs");
}

#[test]
fn test_get_tool_summary_bash() {
    let input = serde_json::json!({"command": "ls -la"});
    assert_eq!(get_tool_summary("Bash", &input), "ls -la");
}
