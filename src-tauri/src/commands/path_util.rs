use std::path::{Path, PathBuf};

use crate::discovery::{path_decoder, subagent_locator};

pub const ERR_INVALID_SESSION_ID: &str = "invalid session id";
pub const ERR_INVALID_PROJECT_ID: &str = "invalid project id";
pub const ERR_INVALID_SUBAGENT_ID: &str = "invalid subagent id";
pub const ERR_ESCAPES_ROOT: &str = "path escapes session root";

/// Validate session+project id pair without touching the filesystem.
/// Call BEFORE any cache lookup keyed on these ids.
pub fn validate_session_id_pair(project_id: &str, session_id: &str) -> Result<(), String> {
    if !path_decoder::is_valid_session_id(session_id) {
        return Err(ERR_INVALID_SESSION_ID.to_string());
    }
    if !path_decoder::is_valid_project_id(project_id) {
        return Err(ERR_INVALID_PROJECT_ID.to_string());
    }
    Ok(())
}

/// Confine `candidate` to `canonical_root`. The root MUST already be
/// canonical (sprint 64: captured once at startup; see
/// `commands::claude_root::ClaudeRoot`). Only the candidate is canonicalized
/// at call time so a symlink swap between startup and call cannot widen
/// the trust boundary by re-evaluating the root.
///
/// Non-existent candidates are returned verbatim — legitimate first-time
/// create flows rely on this.
pub fn confine(candidate: PathBuf, canonical_root: &Path) -> Result<PathBuf, String> {
    if !candidate.exists() {
        return Ok(candidate);
    }
    let canonical_candidate = std::fs::canonicalize(&candidate).map_err(|_| ERR_ESCAPES_ROOT)?;
    if !canonical_candidate.starts_with(canonical_root) {
        return Err(ERR_ESCAPES_ROOT.to_string());
    }
    Ok(canonical_candidate)
}

pub fn resolve_session_path(
    canonical_root: &Path,
    project_id: &str,
    session_id: &str,
) -> Result<PathBuf, String> {
    validate_session_id_pair(project_id, session_id)?;
    let base_dir = path_decoder::extract_base_dir(project_id);
    let candidate = canonical_root.join(base_dir).join(format!("{session_id}.jsonl"));
    confine(candidate, canonical_root)
}

pub fn resolve_subagent_path(
    canonical_root: &Path,
    project_id: &str,
    parent_session_id: &str,
    subagent_id: &str,
) -> Result<PathBuf, String> {
    validate_session_id_pair(project_id, parent_session_id)?;
    if !path_decoder::is_valid_session_id(subagent_id) {
        return Err(ERR_INVALID_SUBAGENT_ID.to_string());
    }
    let candidate = subagent_locator::subagent_path(
        canonical_root,
        project_id,
        parent_session_id,
        subagent_id,
    );
    confine(candidate, canonical_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_SESSION: &str = "0123abcd-4567-89ef-abcd-0123456789ab";
    const VALID_PROJECT: &str = "-Users-name-project";
    const TEST_ROOT: &str = "/tmp/claude/projects";

    fn test_root() -> &'static Path {
        Path::new(TEST_ROOT)
    }

    fn valid_uuids() -> Vec<&'static str> {
        vec![
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
        ]
    }

    fn invalid_session_ids() -> Vec<&'static str> {
        vec![
            "",
            "ABCD",
            "../../../etc/passwd",
            "abc\u{0}def",
            "abc\u{1b}[31m",
            "gggggggg-gggg-gggg-gggg-gggggggggggg",
            "0123abcd-4567-89ef-abcd-0123456789a",
            "0123abcd45678-9ef-abcd-0123456789ab",
            "0123abcd-4567-89ef-abcd-0123456789abc",
        ]
    }

    #[test]
    fn valid_uuids_all_accepted() {
        for id in valid_uuids() {
            assert!(
                path_decoder::is_valid_session_id(id),
                "expected accept: {id}"
            );
        }
    }

    #[test]
    fn invalid_session_ids_all_rejected() {
        for id in invalid_session_ids() {
            assert!(
                !path_decoder::is_valid_session_id(id),
                "expected reject: {id:?}"
            );
        }
    }

    #[test]
    fn validate_pair_rejects_bad_session() {
        let err = validate_session_id_pair(VALID_PROJECT, "../../../etc/passwd").unwrap_err();
        assert_eq!(err, ERR_INVALID_SESSION_ID);
    }

    #[test]
    fn validate_pair_rejects_null_byte_session() {
        let payload = format!("abc\u{0}def-4567-89ef-abcd-0123456789ab");
        let err = validate_session_id_pair(VALID_PROJECT, &payload).unwrap_err();
        assert_eq!(err, ERR_INVALID_SESSION_ID);
    }

    #[test]
    fn validate_pair_rejects_control_char_session() {
        let payload = "abc\u{1b}[31m-4567-89ef-abcd-0123456789ab".to_string();
        let err = validate_session_id_pair(VALID_PROJECT, &payload).unwrap_err();
        assert_eq!(err, ERR_INVALID_SESSION_ID);
    }

    #[test]
    fn validate_pair_rejects_short_session() {
        let err = validate_session_id_pair(VALID_PROJECT, "ABCD").unwrap_err();
        assert_eq!(err, ERR_INVALID_SESSION_ID);
    }

    #[test]
    fn validate_pair_rejects_empty_session() {
        let err = validate_session_id_pair(VALID_PROJECT, "").unwrap_err();
        assert_eq!(err, ERR_INVALID_SESSION_ID);
    }

    #[test]
    fn validate_pair_rejects_no_leading_dash_project() {
        let err = validate_session_id_pair("../escape", VALID_SESSION).unwrap_err();
        assert_eq!(err, ERR_INVALID_PROJECT_ID);
    }

    #[test]
    fn validate_pair_rejects_short_composite_hash() {
        let err = validate_session_id_pair("-Users-name-project::SHORT", VALID_SESSION).unwrap_err();
        assert_eq!(err, ERR_INVALID_PROJECT_ID);
    }

    #[test]
    fn validate_pair_rejects_composite_traversal_hash() {
        let err = validate_session_id_pair("-Users-name-project::../../etc", VALID_SESSION)
            .unwrap_err();
        assert_eq!(err, ERR_INVALID_PROJECT_ID);
    }

    #[test]
    fn validate_pair_rejects_null_byte_in_project() {
        let payload = "-Users-name-project\u{0}".to_string();
        let err = validate_session_id_pair(&payload, VALID_SESSION).unwrap_err();
        assert_eq!(err, ERR_INVALID_PROJECT_ID);
    }

    #[test]
    fn validate_pair_rejects_dotdot_with_null_byte() {
        let payload = "-..\u{0}".to_string();
        let err = validate_session_id_pair(&payload, VALID_SESSION).unwrap_err();
        assert_eq!(err, ERR_INVALID_PROJECT_ID);
    }

    #[test]
    fn validate_pair_rejects_oversize_project() {
        let payload = format!("-foo{}", "a".repeat(1024));
        let err = validate_session_id_pair(&payload, VALID_SESSION).unwrap_err();
        assert_eq!(err, ERR_INVALID_PROJECT_ID);
    }

    #[test]
    fn validate_pair_accepts_valid_composite() {
        let res = validate_session_id_pair("-Users-name-project::abcdef01", VALID_SESSION);
        assert!(res.is_ok());
    }

    #[test]
    fn validate_pair_accepts_dotdot_dirname() {
        let res = validate_session_id_pair("-..", VALID_SESSION);
        assert!(res.is_ok());
    }

    #[test]
    fn resolve_subagent_path_matches_locator_layout() {
        let project_id = VALID_PROJECT;
        let parent = VALID_SESSION;
        let sub = "fedcba98-7654-3210-fedc-ba9876543210";
        let direct = subagent_locator::subagent_path(test_root(), project_id, parent, sub);
        assert_eq!(
            direct,
            PathBuf::from(
                "/tmp/claude/projects/-Users-name-project/0123abcd-4567-89ef-abcd-0123456789ab/subagents/fedcba98-7654-3210-fedc-ba9876543210.jsonl"
            )
        );
    }

    #[test]
    fn resolve_subagent_rejects_traversal_subagent_id() {
        let res = resolve_subagent_path(test_root(), VALID_PROJECT, VALID_SESSION, "../../../etc/passwd");
        assert_eq!(res.unwrap_err(), ERR_INVALID_SUBAGENT_ID);
    }

    #[test]
    fn resolve_subagent_rejects_traversal_parent() {
        let res = resolve_subagent_path(test_root(), VALID_PROJECT, "../../../etc/passwd", VALID_SESSION);
        assert_eq!(res.unwrap_err(), ERR_INVALID_SESSION_ID);
    }
}
