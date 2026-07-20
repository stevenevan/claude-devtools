use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::shared::{
    normalize_error_prefix, parse_timestamp_ms, resolve_project_dir, tool_result_text, RawEntry,
    ToolCall,
};

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

#[derive(Default)]
struct ErrorAccumulator {
    occurrences: u32,
    sessions: std::collections::HashSet<String>,
    last_seen_ms: f64,
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
                    let is_error = block
                        .get("is_error")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
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

    // Go's os.ReadDir returns entries sorted by filename; mirror that.
    let mut entries: Vec<_> = std::fs::read_dir(&project_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut accumulator: HashMap<(String, String), ErrorAccumulator> = HashMap::new();
    let mut scanned_sessions: u32 = 0;

    for entry in entries {
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
            .map(|d| d.as_millis() as f64)
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
