use super::*;

#[test]
fn estimate_tokens_ceils_at_four_chars() {
    assert_eq!(estimate_tokens(""), 0);
    assert_eq!(estimate_tokens("abcd"), 1);
    assert_eq!(estimate_tokens("abcde"), 2);
    assert_eq!(estimate_tokens("abcdefgh"), 2);
}

#[test]
fn format_tokens_shortens_thousands() {
    assert_eq!(format_tokens(500), "500");
    assert_eq!(format_tokens(1500), "1.5k");
    assert_eq!(format_tokens(15000), "15k");
}

#[test]
fn parse_timestamp_ms_returns_positive_for_valid() {
    let ms = parse_timestamp_ms("2024-01-15T10:30:00Z");
    assert!(ms > 0.0, "expected > 0, got {ms}");
}

#[test]
fn parse_timestamp_ms_returns_zero_for_invalid() {
    assert_eq!(parse_timestamp_ms("not-a-timestamp"), 0.0);
}
