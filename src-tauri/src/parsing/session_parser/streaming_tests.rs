use super::*;
use std::io::Write;
use std::path::Path;

fn test_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("claude-devtools-test")
        .join(name);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// parse_jsonl_line

#[test]
fn test_parse_jsonl_line_empty_string() {
    let mut meta = SessionFileMetadata::default();
    assert!(parse_jsonl_line("", &mut meta).is_none());
}

#[test]
fn test_parse_jsonl_line_whitespace_only() {
    let mut meta = SessionFileMetadata::default();
    assert!(parse_jsonl_line("   \t  ", &mut meta).is_none());
}

#[test]
fn test_parse_jsonl_line_malformed_json() {
    let mut meta = SessionFileMetadata::default();
    assert!(parse_jsonl_line("{not valid json}", &mut meta).is_none());
}

#[test]
fn test_parse_jsonl_line_valid_user_entry() {
    let mut meta = SessionFileMetadata::default();
    let line = r#"{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/tmp","sessionId":"s1","version":"1","gitBranch":"main","message":{"role":"user","content":"hello"}}"#;
    let msg = parse_jsonl_line(line, &mut meta).unwrap();
    assert_eq!(msg.message_type, "user");
    assert_eq!(msg.uuid, "u1");
}

#[test]
fn test_parse_jsonl_line_custom_title_metadata() {
    let mut meta = SessionFileMetadata::default();
    let line = r#"{"type":"custom-title","customTitle":"My Session"}"#;
    let result = parse_jsonl_line(line, &mut meta);
    assert!(result.is_none());
    assert_eq!(meta.custom_title.as_deref(), Some("My Session"));
}

#[test]
fn test_parse_jsonl_line_agent_name_metadata() {
    let mut meta = SessionFileMetadata::default();
    let line = r#"{"type":"agent-name","agentName":"code-reviewer"}"#;
    let result = parse_jsonl_line(line, &mut meta);
    assert!(result.is_none());
    assert_eq!(meta.agent_name.as_deref(), Some("code-reviewer"));
}

#[test]
fn test_parse_jsonl_line_unknown_type_skipped() {
    let mut meta = SessionFileMetadata::default();
    let line = r#"{"type":"unknown_thing","uuid":"x1"}"#;
    assert!(parse_jsonl_line(line, &mut meta).is_none());
}

// parse_jsonl_file

#[test]
fn test_parse_jsonl_file_nonexistent() {
    let (result, _) = parse_jsonl_file(Path::new("/nonexistent/file.jsonl")).unwrap();
    assert!(result.is_empty());
}

#[test]
fn test_parse_jsonl_file_empty_file() {
    let dir = test_dir("empty_file");
    let file_path = dir.join("empty.jsonl");
    std::fs::File::create(&file_path).unwrap();

    let (messages, metadata) = parse_jsonl_file(&file_path).unwrap();
    assert!(messages.is_empty());
    assert!(metadata.custom_title.is_none());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_parse_jsonl_file_with_content() {
    let dir = test_dir("with_content");
    let file_path = dir.join("test_session.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/tmp","sessionId":"s1","version":"1","gitBranch":"main","message":{{"role":"user","content":"hello"}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"assistant","uuid":"a1","parentUuid":"u1","isSidechain":false,"userType":"external","cwd":"/tmp","sessionId":"s1","version":"1","gitBranch":"main","requestId":"req1","message":{{"role":"assistant","model":"claude-sonnet-4-20250514","id":"msg1","type":"message","content":[{{"type":"text","text":"Hi!"}}],"stop_reason":"end_turn","stop_sequence":null,"usage":{{"input_tokens":100,"output_tokens":50}}}}}}"#
    )
    .unwrap();

    let (messages, _) = parse_jsonl_file(&file_path).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].message_type, "user");
    assert_eq!(messages[1].message_type, "assistant");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_parse_jsonl_file_skips_blank_lines() {
    let dir = test_dir("blank_lines");
    let file_path = dir.join("blanks.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(file, "").unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"hi"}}}}"#
    )
    .unwrap();
    writeln!(file, "").unwrap();
    writeln!(file, "   ").unwrap();

    let (messages, _) = parse_jsonl_file(&file_path).unwrap();
    assert_eq!(messages.len(), 1);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_parse_jsonl_file_skips_malformed_lines() {
    let dir = test_dir("malformed_lines");
    let file_path = dir.join("mixed.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(file, "{{not json}}").unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"valid"}}}}"#
    )
    .unwrap();
    writeln!(file, "truncated{{").unwrap();

    let (messages, _) = parse_jsonl_file(&file_path).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].uuid, "u1");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_parse_jsonl_file_extracts_metadata() {
    let dir = test_dir("metadata");
    let file_path = dir.join("meta.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(
        file,
        r#"{{"type":"custom-title","customTitle":"Debug Session"}}"#
    )
    .unwrap();
    writeln!(file, r#"{{"type":"agent-name","agentName":"explorer"}}"#).unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"go"}}}}"#
    )
    .unwrap();

    let (messages, metadata) = parse_jsonl_file(&file_path).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(metadata.custom_title.as_deref(), Some("Debug Session"));
    assert_eq!(metadata.agent_name.as_deref(), Some("explorer"));

    let _ = std::fs::remove_dir_all(&dir);
}

// Boundary cases

#[test]
fn test_drops_oversized_line() {
    let mut meta = SessionFileMetadata::default();
    let oversized = format!(
        "{{\"type\":\"user\",\"uuid\":\"u1\",\"parentUuid\":null,\"isSidechain\":false,\"cwd\":\"/tmp\",\"message\":{{\"role\":\"user\",\"content\":\"{}\"}}}}",
        "x".repeat(MAX_JSONL_LINE_BYTES + 1)
    );
    let result = parse_jsonl_line(&oversized, &mut meta);
    assert!(result.is_none(), "oversized line should be dropped");
}

#[test]
fn test_accepts_line_at_cap_boundary() {
    let mut meta = SessionFileMetadata::default();
    let small = r#"{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{"role":"user","content":"hi"}}"#;
    assert!(small.len() < MAX_JSONL_LINE_BYTES);
    let result = parse_jsonl_line(small, &mut meta);
    assert!(result.is_some(), "in-cap line should parse");
}

#[test]
fn test_drops_invalid_json() {
    let mut meta = SessionFileMetadata::default();
    let result = parse_jsonl_line("{not json", &mut meta);
    assert!(result.is_none());
}

#[test]
fn test_empty_line_returns_none() {
    let mut meta = SessionFileMetadata::default();
    assert!(parse_jsonl_line("", &mut meta).is_none());
    assert!(parse_jsonl_line("   ", &mut meta).is_none());
    assert!(parse_jsonl_line("\t\n", &mut meta).is_none());
}

#[test]
fn test_metadata_extracted_without_message() {
    let mut meta = SessionFileMetadata::default();
    let line = r#"{"type":"custom-title","customTitle":"Sprint 56"}"#;
    let result = parse_jsonl_line(line, &mut meta);
    assert!(result.is_none());
    assert_eq!(meta.custom_title.as_deref(), Some("Sprint 56"));
}
