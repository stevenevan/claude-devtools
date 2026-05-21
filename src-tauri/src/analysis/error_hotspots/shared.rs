use std::path::PathBuf;

use serde::Deserialize;

use crate::discovery::path_decoder;
use crate::watcher;

const ERROR_PREFIX_LEN: usize = 100;

#[derive(Deserialize)]
pub(super) struct RawEntry {
    pub(super) timestamp: Option<String>,
    pub(super) message: Option<RawMessage>,
}

#[derive(Deserialize)]
pub(super) struct RawMessage {
    pub(super) role: Option<String>,
    pub(super) content: Option<serde_json::Value>,
}

pub(super) struct ToolCall {
    pub(super) tool_name: String,
}

pub(super) fn parse_timestamp_ms(ts: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis() as f64)
}

pub(super) fn tool_result_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|block| {
                let kind = block.get("type")?.as_str()?;
                if kind == "text" {
                    block.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub(super) fn normalize_error_prefix(text: &str) -> String {
    let trimmed = text.trim();
    let clipped: String = trimmed.chars().take(ERROR_PREFIX_LEN).collect();
    clipped.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn resolve_project_dir(project_id: &str) -> Result<PathBuf, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let base_id = match project_id.find("::") {
        Some(idx) => &project_id[..idx],
        None => project_id,
    };
    let project_dir = projects_dir.join(base_id);
    if !project_dir.is_dir() {
        return Err(format!("Project directory not found: {base_id}"));
    }
    Ok(project_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_prefix() {
        assert_eq!(normalize_error_prefix("  hello   world  "), "hello world");
        let long = "a".repeat(200);
        assert_eq!(
            normalize_error_prefix(&long).chars().count(),
            ERROR_PREFIX_LEN
        );
    }
}
