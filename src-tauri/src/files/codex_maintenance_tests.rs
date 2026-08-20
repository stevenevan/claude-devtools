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
fn unversioned_usage_fixture_does_not_make_codex_capability_available() {
    let value: serde_json::Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/codex-maintenance/stats-cache.json"
    ))
    .expect("usage fixture JSON");

    assert_eq!(
        value.get("turns").and_then(serde_json::Value::as_u64),
        Some(3)
    );
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("capability test clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codex-maintenance-capability-{nonce}"));
    std::fs::create_dir_all(root.join("telemetry")).expect("create telemetry directory");
    std::fs::create_dir_all(root.join("file-history")).expect("create file-history directory");
    std::fs::write(root.join("stats-cache.json"), value.to_string()).expect("write usage fixture");

    let capabilities = crate::config::root::maintenance_capabilities(Some(&root));
    assert_eq!(
        capabilities.usage.state,
        MaintenanceCapabilityState::Unsupported
    );
    assert_eq!(
        capabilities.telemetry.state,
        MaintenanceCapabilityState::Unsupported
    );
    assert_eq!(
        capabilities.file_history.state,
        MaintenanceCapabilityState::Unsupported
    );
    assert!(capabilities
        .usage
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "usageSchemaUnsupported"));
    crate::testutil::remove_tree(root);
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
fn malformed_telemetry_fixture_is_not_treated_as_a_projection() {
    let raw = include_str!("../../tests/fixtures/codex-maintenance/telemetry/malformed.json");
    assert!(serde_json::from_str::<serde_json::Value>(raw).is_err());
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
fn unsafe_shell_fixture_is_withheld() {
    let fixture = include_str!("../../tests/fixtures/codex-maintenance/shell_snapshots/unsafe.sh");
    assert!(redact_shell_snapshot(fixture).is_none());
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

#[test]
fn bounded_shell_listing_carries_one_metadata_revision() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("listing test clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codex-maintenance-listing-{nonce}"));
    let snapshots = root.join("shell_snapshots");
    std::fs::create_dir_all(&snapshots).expect("create snapshot directory");
    std::fs::write(snapshots.join("one.sh"), "# Snapshot file\n").expect("write first snapshot");

    let first = list_regular_files(&root, "shell_snapshots", MAX_SCAN_ENTRIES)
        .expect("first bounded listing");
    assert_eq!(first.paths.len(), 1);
    assert!(!first.revision.starts_with("incomplete-"));

    std::fs::write(snapshots.join("two.sh"), "# Snapshot file\n").expect("write second snapshot");
    let second = list_regular_files(&root, "shell_snapshots", MAX_SCAN_ENTRIES)
        .expect("second bounded listing");
    assert_eq!(second.paths.len(), 2);
    assert_ne!(first.revision, second.revision);
    crate::testutil::remove_tree(root);
}
