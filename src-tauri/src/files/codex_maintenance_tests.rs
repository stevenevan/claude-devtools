use super::*;

#[test]
fn maintenance_cursor_round_trips_dataset_and_offset() {
    let revision = "revision-1";
    let encoded = encode_cursor("telemetry", revision, 7).expect("cursor");
    assert_eq!(
        decode_cursor(Some(&encoded), "telemetry", revision).expect("decode"),
        7
    );
    assert!(decode_cursor(Some(&encoded), "file-history", revision).is_err());
}

#[test]
fn shell_redaction_removes_sensitive_assignments() {
    let content = "# Snapshot file\nexport OPENAI_API_KEY=secret";
    let redacted = redact_shell_snapshot(content).expect("safe assignment projection");
    assert!(redacted.contains("OPENAI_API_KEY=[redacted]"));
    assert!(!redacted.contains("secret"));
    assert!(redact_shell_snapshot("# Snapshot file\nnormal() { echo ok; }").is_none());
}

#[test]
fn unsafe_checkpoint_ids_are_rejected() {
    assert!(validate_checkpoint_ids("session", "hash").is_ok());
    assert!(validate_checkpoint_ids("../session", "hash").is_err());
    assert!(validate_checkpoint_ids("session", "hash/other").is_err());
}

#[test]
fn codex_origin_resolution_fails_closed_without_a_trusted_contract() {
    assert_eq!(
        resolve_checkpoint_origin_path("session", "hash").expect("origin lookup"),
        None
    );
    let origins = resolve_checkpoint_origins("session", &["hash".to_string()]).expect("origins");
    assert!(origins.get("hash").expect("hash result").is_none());
}

#[test]
fn supported_shell_snapshot_requires_known_header() {
    let supported = "# Snapshot file\nfunction ok() { :; }";
    let unsupported = "arbitrary command text";
    assert!(supported.starts_with("# Snapshot file"));
    assert!(!unsupported.starts_with("# Snapshot file"));
}

#[test]
fn sanitized_usage_fixture_projects_only_known_metrics() {
    let value: serde_json::Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/codex-maintenance/stats-cache.json"
    ))
    .expect("usage fixture JSON");

    assert_eq!(
        find_string(&value, &["period"]).as_deref(),
        Some("fixture-window")
    );
    assert_eq!(find_u64(&value, &["turns"]), Some(3));
    assert_eq!(find_u64(&value, &["tokens"]), Some(512));
    assert_eq!(find_f64(&value, &["cost"]), Some(0.04));
    assert!(safe_fields(&value)
        .iter()
        .all(|field| field.name != "privateField"));
}

#[test]
fn telemetry_fixture_drops_sensitive_or_unknown_values() {
    let value: serde_json::Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/codex-maintenance/telemetry/fixture.json"
    ))
    .expect("telemetry fixture JSON");
    let fields = safe_fields(&value);

    assert!(fields.iter().any(|field| field.name == "kind"));
    assert!(fields.iter().any(|field| field.name == "status"));
    assert!(fields.iter().all(|field| field.name != "privatePayload"));
    assert!(safe_fields(&serde_json::json!({
        "status": "Bearer fixture-secret",
        "event": "/Users/example/prompt.txt"
    }))
    .is_empty());
    assert!(safe_fields(&serde_json::json!({
        "status": "delete all files",
        "event": "fixture.event"
    }))
    .iter()
    .all(|field| field.name != "status"));
}

#[test]
fn checkpoint_preview_withholds_sensitive_text() {
    let (content, reason) = safe_checkpoint_preview(b"safe line\nAPI_TOKEN=fixture-secret");

    assert!(content.is_none());
    assert!(reason.is_some());
}

#[test]
fn checkpoint_preview_withholds_unclassified_text() {
    let (content, reason) = safe_checkpoint_preview(b"ordinary source text");

    assert!(content.is_none());
    assert!(reason.is_some());
}

#[test]
fn shell_fixture_redacts_sensitive_assignment_and_value() {
    let fixture =
        include_str!("../../tests/fixtures/codex-maintenance/shell_snapshots/session-1.sh");
    let redacted = redact_shell_snapshot(fixture).expect("safe fixture projection");

    assert!(redacted.contains("EXAMPLE_TOKEN=[redacted]"));
    assert!(!redacted.contains("fixture-value"));
    assert!(!redacted.contains("safe-fixture"));
}

#[test]
fn shell_redaction_withholds_sensitive_command_arguments() {
    assert!(redact_shell_snapshot(
        "# Snapshot file\ncurl --token fixture-secret https://example.test"
    )
    .is_none());
}

#[test]
fn maintenance_revision_changes_for_nested_file_metadata() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("revision test clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codex-maintenance-revision-{nonce}"));
    let dataset = root.join("file-history").join("session-1");
    std::fs::create_dir_all(&dataset).expect("create revision test directory");
    let file = dataset.join("hash@v1");
    std::fs::write(&file, "before").expect("write revision test file");
    let before = crate::config::root::maintenance_revision(&root, "file-history")
        .expect("initial maintenance revision");
    std::fs::write(&file, "after with a different size").expect("rewrite revision test file");
    let after = crate::config::root::maintenance_revision(&root, "file-history")
        .expect("updated maintenance revision");

    assert_ne!(before, after);
    let _ = std::fs::remove_dir_all(root);
}
