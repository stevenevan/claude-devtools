//! Ports `pathutil_test.go` — the @-mention security cases.

use super::*;

const VALID_SESSION: &str = "0123abcd-4567-89ef-abcd-0123456789ab";
const VALID_PROJECT: &str = "-Users-name-project";

const VALID_UUIDS: &[&str] = &[
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "0123abcd-4567-89ef-abcd-0123456789ab",
    "ABCDEF01-2345-6789-abcd-ef0123456789",
    "deadbeef-cafe-babe-feed-c0ffee123456",
    "11111111-2222-3333-4444-555555555555",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "12345678-90ab-cdef-1234-567890abcdef",
    "fedcba98-7654-3210-fedc-ba9876543210",
    "abcdef01-2345-6789-abcd-ef0123456789",
];

const INVALID_SESSION_IDS: &[&str] = &[
    "",
    "ABCD",
    "../../../etc/passwd",
    "abc\x00def",
    "abc\x1b[31m",
    "gggggggg-gggg-gggg-gggg-gggggggggggg",
    "0123abcd-4567-89ef-abcd-0123456789a",
    "0123abcd45678-9ef-abcd-0123456789ab",
    "0123abcd-4567-89ef-abcd-0123456789abc",
];

#[test]
fn valid_uuids_all_accepted() {
    for id in VALID_UUIDS {
        assert!(
            validate_session_id_pair(VALID_PROJECT, id).is_ok(),
            "expected accept for {id:?}"
        );
    }
}

#[test]
fn invalid_session_ids_all_rejected() {
    for id in INVALID_SESSION_IDS {
        let err = validate_session_id_pair(VALID_PROJECT, id)
            .expect_err(&format!("expected reject for {id:?}"));
        assert!(err.contains(ERR_INVALID_SESSION_ID), "wrong error for {id:?}: {err}");
    }
}

#[test]
fn validate_pair_rejects_bad_session() {
    let err = validate_session_id_pair(VALID_PROJECT, "../../../etc/passwd").unwrap_err();
    assert!(err.contains(ERR_INVALID_SESSION_ID));
}

#[test]
fn validate_pair_rejects_null_byte_session() {
    let err =
        validate_session_id_pair(VALID_PROJECT, "abc\x00def-4567-89ef-abcd-0123456789ab").unwrap_err();
    assert!(err.contains(ERR_INVALID_SESSION_ID));
}

#[test]
fn validate_pair_rejects_control_char_session() {
    let err =
        validate_session_id_pair(VALID_PROJECT, "abc\x1b[31m-4567-89ef-abcd-0123456789ab").unwrap_err();
    assert!(err.contains(ERR_INVALID_SESSION_ID));
}

#[test]
fn validate_pair_rejects_short_and_empty_session() {
    assert!(validate_session_id_pair(VALID_PROJECT, "ABCD").unwrap_err().contains(ERR_INVALID_SESSION_ID));
    assert!(validate_session_id_pair(VALID_PROJECT, "").unwrap_err().contains(ERR_INVALID_SESSION_ID));
}

#[test]
fn validate_pair_rejects_bad_projects() {
    for bad in ["../escape", "-Users-name-project::SHORT", "-Users-name-project::../../etc"] {
        let err = validate_session_id_pair(bad, VALID_SESSION).unwrap_err();
        assert!(err.contains(ERR_INVALID_PROJECT_ID), "want project reject for {bad:?}: {err}");
    }
    let err = validate_session_id_pair("-Users-name-project\x00", VALID_SESSION).unwrap_err();
    assert!(err.contains(ERR_INVALID_PROJECT_ID));
    let err = validate_session_id_pair("-..\x00", VALID_SESSION).unwrap_err();
    assert!(err.contains(ERR_INVALID_PROJECT_ID));
    let oversize = format!("-foo{}", "a".repeat(1024));
    let err = validate_session_id_pair(&oversize, VALID_SESSION).unwrap_err();
    assert!(err.contains(ERR_INVALID_PROJECT_ID));
}

#[test]
fn validate_pair_accepts_valid_composite_and_dotdot_dirname() {
    assert!(validate_session_id_pair("-Users-name-project::abcdef01", VALID_SESSION).is_ok());
    assert!(validate_session_id_pair("-..", VALID_SESSION).is_ok());
}

#[test]
fn resolve_subagent_rejects_traversal_subagent_id() {
    let err = resolve_subagent_path("/tmp/claude/projects", VALID_PROJECT, VALID_SESSION, "../../../etc/passwd")
        .unwrap_err();
    assert!(err.contains(ERR_INVALID_SUBAGENT_ID));
}

#[test]
fn resolve_subagent_rejects_traversal_parent() {
    let err = resolve_subagent_path("/tmp/claude/projects", VALID_PROJECT, "../../../etc/passwd", VALID_SESSION)
        .unwrap_err();
    assert!(err.contains(ERR_INVALID_SESSION_ID));
}
