use super::*;

fn scan_fixture(name: &str, content: &str) -> LightSessionSummary {
    let path = std::env::temp_dir().join(format!(
        "claude-devtools-light-scan-{}-{name}.jsonl",
        std::process::id()
    ));
    std::fs::write(&path, content).expect("write fixture");
    let summary = scan_session_light(&path).expect("scan fixture");
    std::fs::remove_file(path).expect("remove fixture");
    summary
}

#[test]
fn returns_tokenless_visible_session() {
    let summary = scan_fixture(
        "tokenless",
        r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hello"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#,
    );

    assert_eq!(summary.message_count, 2);
    assert_eq!(summary.first_user_text.as_deref(), Some("hello"));
    assert_eq!(summary.cost_usd, None);
    assert_eq!(summary.cost_diagnostic, None);
}

#[test]
fn counts_only_visible_main_thread_messages() {
    let summary = scan_fixture(
        "visible",
        r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"meta"}}
{"type":"user","isSidechain":true,"message":{"role":"user","content":"sidechain"}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"result"}]}}
{"type":"user","message":{"role":"user","content":"<system-reminder>technical</system-reminder>"}}
{"type":"user","message":{"role":"user","content":"real"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hidden"}]}}
{"type":"assistant","isCompactSummary":true,"message":{"role":"assistant","content":[{"type":"text","text":"compact"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"visible"}]}}"#,
    );

    assert_eq!(summary.message_count, 2);
    assert_eq!(summary.first_user_text.as_deref(), Some("real"));
}

#[test]
fn deduplicates_request_ids_and_prices_final_usage() {
    let summary = scan_fixture(
        "dedup",
        r#"{"type":"assistant","requestId":"same","timestamp":"2026-08-31T00:00:00Z","message":{"role":"assistant","model":"claude-sonnet-5","content":[{"type":"text","text":"partial"}],"usage":{"input_tokens":100}}}
{"type":"assistant","requestId":"same","timestamp":"2026-09-01T00:00:00Z","message":{"role":"assistant","model":"claude-sonnet-5","content":[{"type":"thinking","thinking":"final metadata"}],"usage":{"input_tokens":200}}}
{"type":"assistant","timestamp":"2026-08-31T00:00:00Z","message":{"role":"assistant","model":"claude-sonnet-5","content":[{"type":"text","text":"independent"}],"usage":{"input_tokens":100}}}"#,
    );

    assert_eq!(summary.message_count, 2);
    assert!((summary.cost_usd.expect("cost") - 0.0008).abs() < 1e-12);
}

#[test]
fn prices_mixed_models_and_cache_by_bucket() {
    let summary = scan_fixture(
        "buckets",
        r#"{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"role":"assistant","model":"claude-opus-4-8","content":"one","usage":{"input_tokens":100,"cache_read_input_tokens":100,"cache_creation_input_tokens":100}}}
{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"role":"assistant","model":"claude-fable-5","content":"two","usage":{"output_tokens":100}}}"#,
    );

    assert!((summary.cost_usd.expect("cost") - 0.006175).abs() < 1e-12);
}

#[test]
fn keeps_row_when_cost_is_unavailable() {
    let summary = scan_fixture(
        "malformed-overflow",
        r#"not-json
{"type":"user","message":{"role":"user","content":"still visible"}}
{"type":"assistant","message":{"role":"assistant","content":"one","usage":{"input_tokens":18446744073709551615}}}
{"type":"assistant","message":{"role":"assistant","content":"two","usage":{"input_tokens":1}}}"#,
    );

    assert_eq!(summary.message_count, 3);
    assert_eq!(summary.first_user_text.as_deref(), Some("still visible"));
    assert_eq!(summary.cost_usd, None);
    assert_eq!(
        summary.cost_diagnostic.as_deref(),
        Some("malformed JSONL record skipped")
    );
}

#[test]
fn bounds_utf8_metadata() {
    let title = "é".repeat(LIGHT_METADATA_MAX_CHARS + 10);
    let preview = "界".repeat(LIGHT_TEXT_MAX_CHARS + 10);
    let fixture = format!(
        r#"{{"type":"custom-title","customTitle":"{title}","agentName":"{title}"}}
{{"type":"user","message":{{"role":"user","content":"{preview}"}}}}"#
    );
    let summary = scan_fixture("utf8", &fixture);

    assert_eq!(
        summary.custom_title.expect("title").chars().count(),
        LIGHT_METADATA_MAX_CHARS
    );
    assert_eq!(
        summary.agent_name.expect("agent").chars().count(),
        LIGHT_METADATA_MAX_CHARS
    );
    assert_eq!(
        summary.first_user_text.expect("preview").chars().count(),
        LIGHT_TEXT_MAX_CHARS
    );
}

#[test]
fn keeps_latest_custom_title() {
    let summary = scan_fixture(
        "latest-title",
        r#"{"type":"custom-title","customTitle":"First title"}
{"type":"custom-title","customTitle":"Latest title"}
{"type":"user","message":{"role":"user","content":"hello"}}"#,
    );

    assert_eq!(summary.custom_title.as_deref(), Some("Latest title"));
}

#[test]
fn skips_oversized_record_then_reads_valid_record() {
    let path = std::env::temp_dir().join(format!(
        "claude-devtools-light-scan-{}-{}.jsonl",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    let oversized = "x".repeat(LIGHT_SCAN_MAX_RECORD_BYTES + 1);
    let valid = r#"{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","customTitle":"after oversized","message":{"role":"assistant","model":"claude-sonnet-4","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":3}}}"#;
    std::fs::write(&path, format!("{oversized}\n{valid}\n")).expect("write fixture");

    let summary = scan_session_light(&path).expect("scan fixture");
    std::fs::remove_file(path).expect("remove fixture");

    assert_eq!(summary.message_count, 1);
    assert_eq!(summary.custom_title.as_deref(), Some("after oversized"));
    assert_eq!(
        summary.cost_diagnostic.as_deref(),
        Some("oversized JSONL record skipped")
    );
    assert_eq!(summary.cost_usd, None);
}
