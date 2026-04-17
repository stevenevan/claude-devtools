/// Per-tool usage analytics — call count, success/error rate, avg duration, median token cost.
///
/// Scans a single project's JSONL sessions using the lightweight `BufReader` pattern
/// from `analytics.rs`. Pairs `tool_use` blocks with their `tool_result` to compute
/// duration and classify success/error.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::analysis::tokenizer;
use crate::discovery::path_decoder;
use crate::watcher;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsageSummary {
    pub tool_name: String,
    pub call_count: u32,
    pub success_count: u32,
    pub error_count: u32,
    pub success_rate: f64,
    pub error_rate: f64,
    pub avg_duration_ms: f64,
    pub median_token_cost: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnalyticsResponse {
    pub tools: Vec<ToolUsageSummary>,
    pub total_calls: u32,
    pub total_errors: u32,
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

struct ToolCallStart {
    tool_name: String,
    start_ms: f64,
}

#[derive(Default)]
struct ToolStats {
    call_count: u32,
    success_count: u32,
    error_count: u32,
    duration_samples: Vec<f64>,
    token_samples: Vec<u64>,
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

/// Scan a single JSONL session, folding tool_use/tool_result pairs into `stats`.
fn scan_session(path: &Path, stats: &mut HashMap<String, ToolStats>) -> Option<()> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::with_capacity(64 * 1024, file);
    let mut in_flight: HashMap<String, ToolCallStart> = HashMap::new();

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
                    in_flight.insert(
                        id,
                        ToolCallStart {
                            tool_name: name,
                            start_ms: ts_ms,
                        },
                    );
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
                    let is_error = block.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                    let result_text = block
                        .get("content")
                        .map(tool_result_text)
                        .unwrap_or_default();
                    let token_count = tokenizer::count_tokens(&result_text) as u64;
                    let duration = (ts_ms - call.start_ms).max(0.0);

                    let entry = stats.entry(call.tool_name).or_default();
                    entry.call_count += 1;
                    if is_error {
                        entry.error_count += 1;
                    } else {
                        entry.success_count += 1;
                    }
                    if duration > 0.0 {
                        entry.duration_samples.push(duration);
                    }
                    entry.token_samples.push(token_count);
                }
            }
            _ => {}
        }
    }
    Some(())
}

fn median_u64(samples: &mut [u64]) -> u64 {
    if samples.is_empty() {
        return 0;
    }
    samples.sort_unstable();
    let mid = samples.len() / 2;
    if samples.len() % 2 == 0 {
        (samples[mid - 1] + samples[mid]) / 2
    } else {
        samples[mid]
    }
}

fn finalize(stats: HashMap<String, ToolStats>) -> Vec<ToolUsageSummary> {
    let mut out: Vec<ToolUsageSummary> = stats
        .into_iter()
        .map(|(name, mut s)| {
            let call_count = s.call_count;
            let avg_duration = if s.duration_samples.is_empty() {
                0.0
            } else {
                s.duration_samples.iter().sum::<f64>() / s.duration_samples.len() as f64
            };
            let median_tokens = median_u64(&mut s.token_samples);
            let (success_rate, error_rate) = if call_count == 0 {
                (0.0, 0.0)
            } else {
                (
                    s.success_count as f64 / call_count as f64,
                    s.error_count as f64 / call_count as f64,
                )
            };
            ToolUsageSummary {
                tool_name: name,
                call_count,
                success_count: s.success_count,
                error_count: s.error_count,
                success_rate,
                error_rate,
                avg_duration_ms: avg_duration,
                median_token_cost: median_tokens,
            }
        })
        .collect();
    out.sort_by(|a, b| b.call_count.cmp(&a.call_count));
    out
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

pub fn compute_tool_analytics(
    project_id: &str,
    days: u32,
) -> Result<ToolAnalyticsResponse, String> {
    let project_dir = resolve_project_dir(project_id)?;
    let days = days.clamp(1, 90);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as f64;
    let cutoff_ms = now_ms - (days as f64) * 86_400_000.0;

    let entries = std::fs::read_dir(&project_dir).map_err(|e| e.to_string())?;
    let mut stats: HashMap<String, ToolStats> = HashMap::new();
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
        scanned_sessions += 1;
        let _ = scan_session(&entry.path(), &mut stats);
    }

    let tools = finalize(stats);
    let total_calls: u32 = tools.iter().map(|t| t.call_count).sum();
    let total_errors: u32 = tools.iter().map(|t| t.error_count).sum();

    Ok(ToolAnalyticsResponse {
        tools,
        total_calls,
        total_errors,
        scanned_sessions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_fixture(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
        let path = dir.join(name);
        let mut f = std::fs::File::create(&path).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
        path
    }

    #[test]
    fn median_odd_even() {
        let mut a = vec![1u64, 5, 9];
        assert_eq!(median_u64(&mut a), 5);
        let mut b = vec![1u64, 5, 9, 11];
        assert_eq!(median_u64(&mut b), 7);
        let mut c: Vec<u64> = vec![];
        assert_eq!(median_u64(&mut c), 0);
    }

    #[test]
    fn scan_pairs_tool_use_and_result() {
        let tmp = std::env::temp_dir().join(format!("tool_analytics_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let lines = [
            r#"{"timestamp":"2026-04-16T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#,
            r#"{"timestamp":"2026-04-16T10:00:02.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok","is_error":false}]}}"#,
            r#"{"timestamp":"2026-04-16T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"cat x"}}]}}"#,
            r#"{"timestamp":"2026-04-16T10:00:06.500Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t2","content":"fail","is_error":true}]}}"#,
            r#"{"timestamp":"2026-04-16T10:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Read","input":{"path":"/a"}}]}}"#,
            r#"{"timestamp":"2026-04-16T10:00:11.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t3","content":"abcdefg","is_error":false}]}}"#,
        ];
        let path = write_fixture(&tmp, "session.jsonl", &lines);

        let mut stats: HashMap<String, ToolStats> = HashMap::new();
        scan_session(&path, &mut stats).unwrap();
        let results = finalize(stats);

        let bash = results.iter().find(|t| t.tool_name == "Bash").unwrap();
        assert_eq!(bash.call_count, 2);
        assert_eq!(bash.success_count, 1);
        assert_eq!(bash.error_count, 1);
        assert!((bash.success_rate - 0.5).abs() < 1e-9);
        assert!((bash.error_rate - 0.5).abs() < 1e-9);
        // Durations: 2000ms and 1500ms → avg 1750
        assert!((bash.avg_duration_ms - 1750.0).abs() < 1e-6);

        let read = results.iter().find(|t| t.tool_name == "Read").unwrap();
        assert_eq!(read.call_count, 1);
        assert_eq!(read.success_count, 1);
        assert_eq!(read.error_count, 0);
        assert!(read.median_token_cost > 0);

        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn finalize_sorts_by_call_count_desc() {
        let mut stats: HashMap<String, ToolStats> = HashMap::new();
        stats.insert("A".to_string(), ToolStats { call_count: 1, success_count: 1, error_count: 0, duration_samples: vec![], token_samples: vec![] });
        stats.insert("B".to_string(), ToolStats { call_count: 5, success_count: 5, error_count: 0, duration_samples: vec![], token_samples: vec![] });
        stats.insert("C".to_string(), ToolStats { call_count: 3, success_count: 2, error_count: 1, duration_samples: vec![], token_samples: vec![] });
        let out = finalize(stats);
        assert_eq!(out[0].tool_name, "B");
        assert_eq!(out[1].tool_name, "C");
        assert_eq!(out[2].tool_name, "A");
    }

    #[test]
    fn orphan_tool_result_ignored() {
        let tmp = std::env::temp_dir().join(format!("tool_analytics_orphan_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let lines = [
            r#"{"timestamp":"2026-04-16T10:00:00.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"missing","content":"x","is_error":false}]}}"#,
        ];
        let path = write_fixture(&tmp, "session.jsonl", &lines);

        let mut stats: HashMap<String, ToolStats> = HashMap::new();
        scan_session(&path, &mut stats).unwrap();
        assert!(stats.is_empty());

        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
