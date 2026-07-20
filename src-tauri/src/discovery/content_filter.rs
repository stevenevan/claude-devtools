/// Session content filter — detect noise-only sessions to skip in the UI.

use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::types::jsonl::RawJsonlEntry;

/// Returns true on the first displayable entry found (early exit for performance).
pub fn has_non_noise_messages(file_path: &Path) -> bool {
    let file = match std::fs::File::open(file_path) {
        Ok(f) => f,
        Err(_) => return false,
    };

    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        if let Ok(entry) = serde_json::from_str::<RawJsonlEntry>(&line) {
            if is_displayable_entry(&entry) {
                return true;
            }
        }
    }

    false
}

fn is_displayable_entry(entry: &RawJsonlEntry) -> bool {
    match entry.entry_type.as_str() {
        "assistant" => {
            // Filter synthetic assistant messages
            if let Some(ref msg) = entry.message {
                if let Some(model) = msg.get("model").and_then(|v| v.as_str()) {
                    if model == "<synthetic>" {
                        return false;
                    }
                }
            }
            entry.uuid.is_some()
        }
        "user" => {
            if entry.uuid.is_none() {
                return false;
            }
            // Skip meta messages (tool results)
            if entry.is_meta == Some(true) {
                return false;
            }
            // Check content for displayability
            if let Some(ref msg) = entry.message {
                if let Some(content) = msg.get("content") {
                    return is_displayable_content(content);
                }
            }
            false
        }
        _ => false,
    }
}

/// Check if message content is displayable (not just noise tags).
fn is_displayable_content(content: &serde_json::Value) -> bool {
    match content {
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return false;
            }
            // Skip noise-only content
            let noise_prefixes = [
                "<local-command-caveat>",
                "<system-reminder>",
                "<local-command-stdout></local-command-stdout>",
                "<local-command-stderr></local-command-stderr>",
                "[Request interrupted by user",
            ];
            for prefix in &noise_prefixes {
                if trimmed.starts_with(prefix) {
                    return false;
                }
            }
            true
        }
        serde_json::Value::Array(blocks) => {
            // Must have at least one text or image block with real content
            blocks.iter().any(|block| {
                let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match block_type {
                    "text" => {
                        if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                            let trimmed = text.trim();
                            !trimmed.is_empty()
                                && !trimmed.starts_with("[Request interrupted by user")
                                && !trimmed.starts_with("<local-command-caveat>")
                                && !trimmed.starts_with("<system-reminder>")
                        } else {
                            false
                        }
                    }
                    "image" => true,
                    _ => false,
                }
            })
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_displayable_string_content() {
        let val = serde_json::json!("hello world");
        assert!(is_displayable_content(&val));
    }

    #[test]
    fn test_noise_content_caveat() {
        let val = serde_json::json!("<local-command-caveat>stuff</local-command-caveat>");
        assert!(!is_displayable_content(&val));
    }

    #[test]
    fn test_noise_content_empty_stdout() {
        let val = serde_json::json!("<local-command-stdout></local-command-stdout>");
        assert!(!is_displayable_content(&val));
    }

    #[test]
    fn test_displayable_array_content() {
        let val = serde_json::json!([{"type": "text", "text": "hello"}]);
        assert!(is_displayable_content(&val));
    }

    #[test]
    fn test_noise_array_interruption() {
        let val = serde_json::json!([{"type": "text", "text": "[Request interrupted by user]"}]);
        assert!(!is_displayable_content(&val));
    }
}
