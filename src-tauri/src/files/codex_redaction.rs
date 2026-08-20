//! Small, shared redaction helpers for Codex inspection responses.

pub(crate) const REDACTED: &str = "[redacted]";

const SENSITIVE_KEY_PARTS: &[&str] = &[
    "apikey",
    "authorization",
    "clientsecret",
    "password",
    "privatekey",
    "secret",
    "token",
];

const SENSITIVE_TOKEN_PREFIXES: &[&str] = &[
    "akia",
    "asia",
    "AIza",
    "ghp_",
    "github_pat_",
    "npm_",
    "pypi-",
    "sk-",
    "xoxb-",
    "xoxp-",
];

pub(crate) fn bounded_display(value: &str, max_bytes: usize) -> String {
    let mut result = String::new();
    for character in value.chars().filter(|character| !character.is_control()) {
        let next_len = result.len() + character.len_utf8();
        if next_len > max_bytes {
            break;
        }
        result.push(character);
    }
    result
}

/// Redacts common credential-shaped values before inspection text crosses IPC.
/// Unknown free-form text is preserved because this helper is a format filter,
/// not a claim that arbitrary prose can be classified as safe.
pub(crate) fn redact_known_secrets(value: &str) -> String {
    if value.contains("-----BEGIN") && value.contains("PRIVATE KEY-----") {
        return REDACTED.to_string();
    }

    let mut result = String::with_capacity(value.len());
    let mut token_start = 0;
    let mut redact_next = false;
    for (index, character) in value.char_indices() {
        if !character.is_whitespace() {
            continue;
        }
        append_redacted_token(&mut result, &value[token_start..index], &mut redact_next);
        result.push(character);
        token_start = index + character.len_utf8();
    }
    append_redacted_token(&mut result, &value[token_start..], &mut redact_next);
    result
}

fn append_redacted_token(result: &mut String, token: &str, redact_next: &mut bool) {
    if token.is_empty() {
        return;
    }

    let trimmed = token.trim_matches(|character: char| {
        matches!(character, '"' | '\'' | ',' | ';' | ')' | ']' | '}')
    });
    let normalized = trimmed.to_ascii_lowercase();
    if *redact_next {
        result.push_str(REDACTED);
        *redact_next = normalized == "bearer";
        return;
    }
    if normalized == "bearer" {
        result.push_str(token);
        *redact_next = true;
        return;
    }
    if SENSITIVE_TOKEN_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(&prefix.to_ascii_lowercase()))
    {
        result.push_str(REDACTED);
        return;
    }

    let Some(separator) = token.find(|character| matches!(character, '=' | ':')) else {
        result.push_str(token);
        return;
    };
    let key = token[..separator]
        .trim_matches(|character: char| matches!(character, '"' | '\'' | '{' | '[' | ','));
    let normalized_key: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect();
    let value_part = token[separator + 1..].trim();
    if !SENSITIVE_KEY_PARTS
        .iter()
        .any(|part| normalized_key.contains(part))
    {
        result.push_str(token);
    } else if value_part.is_empty() {
        result.push_str(token);
        *redact_next = true;
    } else {
        result.push_str(&token[..=separator]);
        result.push_str(REDACTED);
    }
}

pub(crate) fn safe_name(value: &str, max_bytes: usize) -> Option<String> {
    if value.is_empty()
        || value.len() > max_bytes
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return None;
    }
    Some(value.to_string())
}

pub(crate) fn redacted_values(count: usize) -> Vec<String> {
    vec![REDACTED.to_string(); count]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_display_removes_controls_and_limits_utf8_bytes() {
        assert_eq!(bounded_display("safe\nvalue", 32), "safevalue");
        assert_eq!(bounded_display("ééé", 3), "é");
    }

    #[test]
    fn safe_name_rejects_paths_and_controls() {
        assert_eq!(safe_name("server_1", 32).as_deref(), Some("server_1"));
        assert!(safe_name("../server", 32).is_none());
        assert!(safe_name("server\n", 32).is_none());
    }

    #[test]
    fn redacted_values_never_include_input() {
        let values = redacted_values(2);
        assert_eq!(values, vec![REDACTED.to_string(), REDACTED.to_string()]);
    }

    #[test]
    fn redact_known_secrets_removes_credentials_and_preserves_safe_text() {
        let value =
            "safe API_KEY=sk-test-value access_token=opaque-value and Authorization: Bearer bearer-value";
        let redacted = redact_known_secrets(value);

        assert_eq!(
            redacted,
            "safe API_KEY=[redacted] access_token=[redacted] and Authorization: [redacted] [redacted]"
        );
        assert!(!redacted.contains("sk-test-value"));
        assert!(!redacted.contains("opaque-value"));
        assert!(!redacted.contains("bearer-value"));
    }

    #[test]
    fn redact_known_secrets_removes_private_key_blocks_and_known_prefixes() {
        let value = "ghp_example -----BEGIN PRIVATE KEY----- body -----END PRIVATE KEY-----";
        let redacted = redact_known_secrets(value);

        assert_eq!(redacted, "[redacted]");
        assert!(!redacted.contains("ghp_example"));
        assert!(!redacted.contains("PRIVATE KEY"));
    }
}
