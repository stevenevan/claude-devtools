/// Path encoding/decoding for Claude Code project directory names.
///
/// Directory naming: /Users/username/project → -Users-username-project
/// This encoding is LOSSY for paths containing dashes.

use std::path::{Path, PathBuf};

use regex::Regex;
use std::sync::LazyLock;

// Core Encoding/Decoding

/// Decode a project directory name to its original path (lossy).
pub fn decode_path(encoded_name: &str) -> String {
    if encoded_name.is_empty() {
        return String::new();
    }

    // Legacy Windows format: "C--Users-name-project"
    static LEGACY_WIN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^([a-zA-Z])--(.+)$").unwrap());

    if let Some(caps) = LEGACY_WIN.captures(encoded_name) {
        let drive = caps[1].to_uppercase();
        let rest = caps[2].replace('-', "/");
        return format!("{drive}:/{rest}");
    }

    let without_leading = if encoded_name.starts_with('-') {
        &encoded_name[1..]
    } else {
        encoded_name
    };

    let decoded = without_leading.replace('-', "/");

    // Windows drive path: "C:/..."
    if decoded.len() >= 3 && decoded.as_bytes()[1] == b':' && decoded.as_bytes()[2] == b'/' {
        return decoded;
    }

    if decoded.starts_with('/') {
        decoded
    } else {
        format!("/{decoded}")
    }
}

/// Extract project display name (last path segment).
pub fn extract_project_name(encoded_name: &str, cwd_hint: Option<&str>) -> String {
    if let Some(cwd) = cwd_hint {
        let segments: Vec<&str> = cwd.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
        if let Some(last) = segments.last() {
            return last.to_string();
        }
    }
    let decoded = decode_path(encoded_name);
    let segments: Vec<&str> = decoded.split('/').filter(|s| !s.is_empty()).collect();
    segments
        .last()
        .map(|s| s.to_string())
        .unwrap_or_else(|| encoded_name.to_string())
}

// Validation

static VALID_ENCODED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^-[a-zA-Z0-9_.\s:-]+$").unwrap());

static LEGACY_WIN_VALID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z]--[a-zA-Z0-9_.\s-]+$").unwrap());

/// Validate if a directory name follows the Claude Code encoding pattern.
pub fn is_valid_encoded_path(encoded_name: &str) -> bool {
    if encoded_name.is_empty() {
        return false;
    }

    // Legacy Windows format
    if LEGACY_WIN_VALID.is_match(encoded_name) {
        return true;
    }

    if !encoded_name.starts_with('-') {
        return false;
    }

    if !VALID_ENCODED.is_match(encoded_name) {
        return false;
    }

    // Windows drive syntax only at the beginning
    if let Some(first_colon) = encoded_name.find(':') {
        // Must be like -C:
        if !encoded_name[..3].starts_with("-") || encoded_name.as_bytes()[2] != b':' {
            return false;
        }
        // No more colons
        if encoded_name[first_colon + 1..].contains(':') {
            return false;
        }
    }

    true
}

/// Extract the base directory from a project ID.
/// For composite IDs (`{encoded}::{hash}`), returns the encoded part.
pub fn extract_base_dir(project_id: &str) -> &str {
    if let Some(sep) = project_id.find("::") {
        &project_id[..sep]
    } else {
        project_id
    }
}

// Path Construction

pub fn build_todo_path(claude_base: &Path, session_id: &str) -> PathBuf {
    claude_base.join("todos").join(format!("{session_id}.json"))
}

pub fn get_projects_base_path(claude_dir: &Path) -> PathBuf {
    claude_dir.join("projects")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_path(absolute_path: &str) -> String {
        if absolute_path.is_empty() {
            return String::new();
        }
        let encoded = absolute_path.replace(['/', '\\'], "-");
        if encoded.starts_with('-') {
            encoded
        } else {
            format!("-{encoded}")
        }
    }

    fn is_valid_project_id(project_id: &str) -> bool {
        static COMPOSITE_HASH: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^[a-f0-9]{8}$").unwrap());

        if project_id.is_empty() {
            return false;
        }
        if let Some(sep) = project_id.find("::") {
            let base = &project_id[..sep];
            let hash = &project_id[sep + 2..];
            is_valid_encoded_path(base) && COMPOSITE_HASH.is_match(hash)
        } else {
            is_valid_encoded_path(project_id)
        }
    }

    fn build_session_path(base_path: &Path, project_id: &str, session_id: &str) -> PathBuf {
        base_path
            .join(extract_base_dir(project_id))
            .join(format!("{session_id}.jsonl"))
    }

    #[test]
    fn test_encode_path() {
        assert_eq!(encode_path("/Users/name/project"), "-Users-name-project");
        assert_eq!(encode_path(""), "");
    }

    #[test]
    fn test_decode_path() {
        assert_eq!(decode_path("-Users-name-project"), "/Users/name/project");
        assert_eq!(decode_path(""), "");
    }

    #[test]
    fn test_decode_legacy_windows() {
        assert_eq!(decode_path("C--Users-name-project"), "C:/Users/name/project");
    }

    #[test]
    fn test_extract_project_name_with_hint() {
        assert_eq!(
            extract_project_name("-Users-name-my-project", Some("/Users/name/my-project")),
            "my-project"
        );
    }

    #[test]
    fn test_extract_project_name_without_hint() {
        assert_eq!(
            extract_project_name("-Users-name-project", None),
            "project"
        );
    }

    #[test]
    fn test_is_valid_encoded_path() {
        assert!(is_valid_encoded_path("-Users-name-project"));
        assert!(is_valid_encoded_path("-C:-Users-name-project"));
        assert!(is_valid_encoded_path("C--Users-name-project"));
        assert!(!is_valid_encoded_path(""));
        assert!(!is_valid_encoded_path("no-leading-dash"));
        assert!(!is_valid_encoded_path("-invalid/chars"));
    }

    #[test]
    fn test_is_valid_project_id_composite() {
        assert!(is_valid_project_id("-Users-name-project::abcdef01"));
        assert!(!is_valid_project_id("-Users-name-project::short"));
        assert!(!is_valid_project_id("-Users-name-project::ABCDEF01")); // uppercase
    }

    #[test]
    fn test_extract_base_dir() {
        assert_eq!(extract_base_dir("-Users-name-project"), "-Users-name-project");
        assert_eq!(
            extract_base_dir("-Users-name-project::abcdef01"),
            "-Users-name-project"
        );
    }

    #[test]
    fn test_build_session_path() {
        let base = Path::new("/home/.claude/projects");
        let path = build_session_path(base, "-Users-name-project", "sess123");
        assert_eq!(
            path,
            PathBuf::from("/home/.claude/projects/-Users-name-project/sess123.jsonl")
        );
    }

    #[test]
    fn test_build_session_path_composite() {
        let base = Path::new("/home/.claude/projects");
        let path = build_session_path(base, "-Users-name-project::abcdef01", "sess123");
        assert_eq!(
            path,
            PathBuf::from("/home/.claude/projects/-Users-name-project/sess123.jsonl")
        );
    }

    // =========================================================================
    // Lossy path decoding edge cases
    // =========================================================================

    #[test]
    fn test_decode_path_with_dashes_in_name() {
        // Paths with dashes are lossy: /Users/name/my-project → -Users-name-my-project
        // Decodes to /Users/name/my/project (wrong!)
        let encoded = encode_path("/Users/name/my-project");
        assert_eq!(encoded, "-Users-name-my-project");
        let decoded = decode_path(&encoded);
        // Known lossy behavior: dashes become slashes
        assert_eq!(decoded, "/Users/name/my/project");
    }

    #[test]
    fn test_extract_project_name_with_hint_recovers_dashes() {
        // cwd_hint allows recovering the correct name
        assert_eq!(
            extract_project_name("-Users-name-my-project", Some("/Users/name/my-project")),
            "my-project"
        );
    }

    #[test]
    fn test_decode_path_deep_nesting() {
        let decoded = decode_path("-Users-name-code-repos-project-v2");
        assert_eq!(decoded, "/Users/name/code/repos/project/v2");
    }

    #[test]
    fn test_decode_windows_modern_drive() {
        let decoded = decode_path("-C:-Users-name-project");
        assert_eq!(decoded, "C:/Users/name/project");
    }

    #[test]
    fn test_is_valid_encoded_path_rejects_special_chars() {
        assert!(!is_valid_encoded_path("-Users/name"));
        assert!(!is_valid_encoded_path("-Users\\name"));
        assert!(!is_valid_encoded_path("-Users@name"));
    }

    #[test]
    fn test_is_valid_encoded_path_dots_and_underscores() {
        assert!(is_valid_encoded_path("-Users-name-my_project.v2"));
    }

    #[test]
    fn test_build_todo_path() {
        let path = build_todo_path(Path::new("/home/.claude"), "sess123");
        assert_eq!(
            path,
            PathBuf::from("/home/.claude/todos/sess123.json")
        );
    }

    #[test]
    fn test_get_projects_base_path() {
        let path = get_projects_base_path(Path::new("/home/.claude"));
        assert_eq!(path, PathBuf::from("/home/.claude/projects"));
    }

    #[test]
    fn test_extract_project_name_no_hint_single_dash() {
        // "-" decodes to empty segments — falls back to encoded name
        assert_eq!(extract_project_name("-", None), "-");
    }
}
