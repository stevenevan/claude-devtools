use super::*;
use serde_json::{json, Value};

#[test]
fn stored_notification_serializes_flat() {
    let stored = StoredNotification {
        error: DetectedError {
            id: "abc".to_string(),
            session_id: "sess".to_string(),
            project_id: "proj".to_string(),
            file_path: "/f".to_string(),
            source: "Bash".to_string(),
            message: "boom".to_string(),
            line_number: Some(1),
            context: ErrorContext {
                project_name: "myproj".to_string(),
                ..Default::default()
            },
            ..Default::default()
        },
        is_read: false,
        created_at: 999.0,
    };

    let value = serde_json::to_value(&stored).expect("serialize");
    let obj = value.as_object().expect("object");

    for key in [
        "id",
        "sessionId",
        "projectId",
        "filePath",
        "source",
        "message",
        "lineNumber",
        "context",
        "isRead",
        "createdAt",
    ] {
        assert!(obj.contains_key(key), "missing top-level key {key}");
    }
    // No wrapper key — flatten must lift the fields to the top level.
    assert!(!obj.contains_key("error"));
    assert!(!obj.contains_key("detectedError"));
}

#[test]
fn create_detected_error_truncates_and_sets_line_number() {
    let long = "x".repeat(600);
    let err = create_detected_error(CreateDetectedErrorParams {
        session_id: "s".to_string(),
        project_id: "p".to_string(),
        file_path: "/f".to_string(),
        project_name: "proj".to_string(),
        line_number: 42,
        source: "Bash".to_string(),
        message: long,
        timestamp_ms: 123.0,
        ..Default::default()
    });

    assert_eq!(err.message.len(), 503); // 500 chars + "..."
    assert!(err.message.ends_with("..."));
    assert_eq!(err.line_number, Some(42));
    assert!(!err.id.is_empty());
    assert_eq!(err.context.project_name, "proj");
}

#[test]
fn rule_predicate_round_trips_tagged_json() {
    let predicate = RulePredicate::Error { is_error: true };
    let value = serde_json::to_value(&predicate).expect("serialize");
    assert_eq!(value, json!({"kind": "error", "isError": true}));

    let parsed: RulePredicate =
        serde_json::from_value(json!({"kind": "durationGt", "ms": 5000.0})).expect("deserialize");
    assert_eq!(parsed, RulePredicate::DurationGt { ms: 5000.0 });
}

#[test]
fn rule_node_and_action_round_trip() {
    let rule = NotificationRule {
        id: "r1".to_string(),
        name: "match".to_string(),
        enabled: true,
        condition: RuleNode::All {
            children: vec![RuleNode::Predicate {
                predicate: RulePredicate::ToolName {
                    equals: "Read".to_string(),
                },
            }],
        },
        action: RuleAction::Notify,
    };

    let value = serde_json::to_value(&rule).expect("serialize");
    let round: NotificationRule = serde_json::from_value(value.clone()).expect("deserialize");
    assert_eq!(round, rule);

    // Action serializes as a bare tagged object.
    let action = value.get("action").and_then(Value::as_object).unwrap();
    assert_eq!(action.get("kind").unwrap(), "notify");
}
