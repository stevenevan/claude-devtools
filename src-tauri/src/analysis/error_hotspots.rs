/// Cross-session error hotspot detection.
///
/// Scans all project sessions for `tool_result` blocks with `is_error: true`,
/// groups by `(tool_name, error_prefix[0..100])`, and returns the hotspots that
/// recur across a minimum number of sessions within a time window.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::discovery::path_decoder;
use crate::watcher;

const ERROR_PREFIX_LEN: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatedToolError {
    pub tool_name: String,
    pub error_prefix: String,
    pub occurrences: u32,
    pub session_count: u32,
    pub session_ids: Vec<String>,
    pub last_seen_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorHotspotsResponse {
    pub repeated_errors: Vec<RepeatedToolError>,
    pub scanned_sessions: u32,
}

#[derive(Deserialize)]
struct RawEntry {
    timestamp: Option<String>,
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    role: Option<String>,
    content: Option<serde_json::Value>,
}

struct ToolCall {
    tool_name: String,
}

#[derive(Default)]
struct ErrorAccumulator {
    occurrences: u32,
    sessions: std::collections::HashSet<String>,
    last_seen_ms: f64,
}

fn parse_timestamp_ms(ts: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis() as f64)
}

fn tool_result_text(content: &serde_json::Value) -> String {
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

fn normalize_error_prefix(text: &str) -> String {
    let trimmed = text.trim();
    let clipped: String = trimmed.chars().take(ERROR_PREFIX_LEN).collect();
    clipped.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn scan_session(
    path: &Path,
    session_id: &str,
    accumulator: &mut HashMap<(String, String), ErrorAccumulator>,
) -> Option<()> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::with_capacity(64 * 1024, file);
    let mut in_flight: HashMap<String, ToolCall> = HashMap::new();

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let entry: RawEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ts_ms = entry
            .timestamp
            .as_deref()
            .and_then(parse_timestamp_ms)
            .unwrap_or(0.0);
        let msg = match entry.message {
            Some(m) => m,
            None => continue,
        };
        let content = match msg.content {
            Some(c) => c,
            None => continue,
        };
        let blocks = match content.as_array() {
            Some(a) => a,
            None => continue,
        };

        match msg.role.as_deref() {
            Some("assistant") => {
                for block in blocks {
                    if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                        continue;
                    }
                    let id = match block.get("id").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    let name = block
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    in_flight.insert(id, ToolCall { tool_name: name });
                }
            }
            Some("user") => {
                for block in blocks {
                    if block.get("type").and_then(|v| v.as_str()) != Some("tool_result") {
                        continue;
                    }
                    let id = match block.get("tool_use_id").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    let call = match in_flight.remove(&id) {
                        Some(c) => c,
                        None => continue,
                    };
                    let is_error =
                        block.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !is_error {
                        continue;
                    }
                    let result_text = block
                        .get("content")
                        .map(tool_result_text)
                        .unwrap_or_default();
                    let prefix = normalize_error_prefix(&result_text);
                    if prefix.is_empty() {
                        continue;
                    }
                    let key = (call.tool_name, prefix);
                    let acc = accumulator.entry(key).or_default();
                    acc.occurrences += 1;
                    acc.sessions.insert(session_id.to_string());
                    if ts_ms > acc.last_seen_ms {
                        acc.last_seen_ms = ts_ms;
                    }
                }
            }
            _ => {}
        }
    }
    Some(())
}

fn resolve_project_dir(project_id: &str) -> Result<PathBuf, String> {
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

pub fn compute_error_hotspots(
    project_id: &str,
    days: u32,
    min_occurrences: u32,
) -> Result<ErrorHotspotsResponse, String> {
    let project_dir = resolve_project_dir(project_id)?;
    let days = days.clamp(1, 90);
    let min_occurrences = min_occurrences.max(2);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as f64;
    let cutoff_ms = now_ms - (days as f64) * 86_400_000.0;

    let entries = std::fs::read_dir(&project_dir).map_err(|e| e.to_string())?;
    let mut accumulator: HashMap<(String, String), ErrorAccumulator> = HashMap::new();
    let mut scanned_sessions: u32 = 0;

    for entry in entries.flatten() {
        let fname = entry.file_name();
        let fname = fname.to_string_lossy();
        if !fname.ends_with(".jsonl") {
            continue;
        }
        let modified_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        if modified_ms < cutoff_ms {
            continue;
        }
        let session_id = fname.trim_end_matches(".jsonl").to_string();
        scanned_sessions += 1;
        let _ = scan_session(&entry.path(), &session_id, &mut accumulator);
    }

    let mut hotspots: Vec<RepeatedToolError> = accumulator
        .into_iter()
        .filter_map(|((tool_name, error_prefix), acc)| {
            if acc.occurrences < min_occurrences {
                return None;
            }
            let mut session_ids: Vec<String> = acc.sessions.into_iter().collect();
            session_ids.sort();
            Some(RepeatedToolError {
                tool_name,
                error_prefix,
                occurrences: acc.occurrences,
                session_count: session_ids.len() as u32,
                session_ids,
                last_seen_ms: acc.last_seen_ms,
            })
        })
        .collect();

    hotspots.sort_by(|a, b| b.occurrences.cmp(&a.occurrences));

    Ok(ErrorHotspotsResponse {
        repeated_errors: hotspots,
        scanned_sessions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_prefix() {
        assert_eq!(normalize_error_prefix("  hello   world  "), "hello world");
        let long = "a".repeat(200);
        assert_eq!(normalize_error_prefix(&long).chars().count(), ERROR_PREFIX_LEN);
    }
}
