//! Small, shared redaction helpers for Codex inspection responses.

pub(crate) const REDACTED: &str = "[redacted]";

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
}
