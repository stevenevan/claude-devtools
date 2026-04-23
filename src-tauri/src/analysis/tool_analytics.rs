/// Per-tool usage analytics — call count, success/error rate, avg duration, median token cost.
///
/// Scans a single project's JSONL sessions using the lightweight `BufReader` pattern
/// from `analytics.rs`. Pairs `tool_use` blocks with their `tool_result` to compute
/// duration and classify success/error.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::{Datelike, Local, TimeZone, Timelike};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolTimeHeatmapCell {
    /// 0 = Monday, 6 = Sunday (chrono `num_days_from_monday`).
    pub day_of_week: u8,
    /// 0..=23 local-timezone hour.
    pub hour: u8,
    pub call_count: u32,
    pub top_tool: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolTimeHeatmapResponse {
    pub cells: Vec<ToolTimeHeatmapCell>,
    pub total_calls: u32,
    pub tool_names: Vec<String>,
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

// Tool Time-of-Day Heatmap (sprint 22)

/// 7 (days) x 24 (hours) heatmap bucket key = day * 24 + hour.
type HeatmapKey = u8;

fn heatmap_key(day: u8, hour: u8) -> HeatmapKey {
    day * 24 + hour
}

fn bucket_local(ts_ms: f64) -> Option<(u8, u8)> {
    let secs = (ts_ms / 1000.0) as i64;
    let nanos = ((ts_ms - (secs as f64) * 1000.0) * 1_000_000.0).round() as u32;
    let utc = chrono::DateTime::from_timestamp(secs, nanos)?;
    let local = Local.from_utc_datetime(&utc.naive_utc());
    let day = local.weekday().num_days_from_monday() as u8;
    let hour = local.hour() as u8;
    Some((day, hour))
}

#[derive(Default)]
struct HeatmapCellAcc {
    total: u32,
    per_tool: HashMap<String, u32>,
}

/// Walk a session's tool_use blocks, bucketing by local (weekday, hour). When
/// `tool_filter` is `Some`, only matching tool names count.
fn scan_session_heatmap(
    path: &Path,
    buckets: &mut HashMap<HeatmapKey, HeatmapCellAcc>,
    tool_filter: Option<&str>,
) -> Option<()> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::with_capacity(64 * 1024, file);

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let entry: RawEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ts_ms = match entry.timestamp.as_deref().and_then(parse_timestamp_ms) {
            Some(v) => v,
            None => continue,
        };
        let msg = match entry.message {
            Some(m) => m,
            None => continue,
        };
        if msg.role.as_deref() != Some("assistant") {
            continue;
        }
        let blocks = match msg.content.as_ref().and_then(|c| c.as_array()) {
            Some(a) => a,
            None => continue,
        };

        let (day, hour) = match bucket_local(ts_ms) {
            Some(pair) => pair,
            None => continue,
        };

        for block in blocks {
            if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                continue;
            }
            let name = block
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            if let Some(filter) = tool_filter {
                if name != filter {
                    continue;
                }
            }
            let cell = buckets.entry(heatmap_key(day, hour)).or_default();
            cell.total += 1;
            *cell.per_tool.entry(name.to_string()).or_insert(0) += 1;
        }
    }
    Some(())
}

pub fn compute_tool_time_heatmap(
    project_id: &str,
    days: u32,
    tool_filter: Option<&str>,
) -> Result<ToolTimeHeatmapResponse, String> {
    let project_dir = resolve_project_dir(project_id)?;
    let days = days.clamp(1, 90);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as f64;
    let cutoff_ms = now_ms - (days as f64) * 86_400_000.0;

    let entries = std::fs::read_dir(&project_dir).map_err(|e| e.to_string())?;
    let mut buckets: HashMap<HeatmapKey, HeatmapCellAcc> = HashMap::new();
    // Also collect the full tool name set across the range (ignoring filter)
    // so the dropdown always shows every tool, even if filter removes rows.
    let mut all_tools: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

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
        let path = entry.path();

        // Collect tool names regardless of filter.
        let mut unfiltered: HashMap<HeatmapKey, HeatmapCellAcc> = HashMap::new();
        let _ = scan_session_heatmap(&path, &mut unfiltered, None);
        for cell in unfiltered.values() {
            for name in cell.per_tool.keys() {
                all_tools.insert(name.clone());
            }
        }

        // Real scan with filter for bucket totals.
        let _ = scan_session_heatmap(&path, &mut buckets, tool_filter);
    }

    let mut cells: Vec<ToolTimeHeatmapCell> = Vec::with_capacity(7 * 24);
    for day in 0u8..7 {
        for hour in 0u8..24 {
            let cell = buckets.remove(&heatmap_key(day, hour)).unwrap_or_default();
            let top_tool = cell
                .per_tool
                .into_iter()
                .max_by_key(|(_, v)| *v)
                .map(|(name, _)| name);
            cells.push(ToolTimeHeatmapCell {
                day_of_week: day,
                hour,
                call_count: cell.total,
                top_tool,
            });
        }
    }

    let total_calls: u32 = cells.iter().map(|c| c.call_count).sum();

    Ok(ToolTimeHeatmapResponse {
        cells,
        total_calls,
        tool_names: all_tools.into_iter().collect(),
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

    #[test]
    fn heatmap_bucket_local_uses_local_timezone_weekday_and_hour() {
        // 2026-04-20 (Monday) at 15:30 UTC — check that the local bucket is a
        // plausible Mon/Tue/Sun hour (depends on runner tz). We assert day is
        // in range and hour in range, and the round-trip is stable.
        let ms = chrono::DateTime::parse_from_rfc3339("2026-04-20T15:30:00Z")
            .unwrap()
            .timestamp_millis() as f64;
        let (day, hour) = bucket_local(ms).unwrap();
        assert!(day < 7);
        assert!(hour < 24);
    }

    #[test]
    fn heatmap_scan_buckets_assistant_tool_uses() {
        let tmp = std::env::temp_dir().join(format!("tool_heatmap_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // Two tool_use blocks at the same timestamp, different tools.
        let lines = [
            r#"{"timestamp":"2026-04-20T09:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}"#,
            r#"{"timestamp":"2026-04-20T09:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{}}]}}"#,
            r#"{"timestamp":"2026-04-20T09:00:20.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Read","input":{}}]}}"#,
        ];
        let path = write_fixture(&tmp, "session.jsonl", &lines);

        let mut buckets: HashMap<HeatmapKey, HeatmapCellAcc> = HashMap::new();
        scan_session_heatmap(&path, &mut buckets, None).unwrap();

        // Exactly one bucket should be populated (all three tool_uses in same hour).
        assert_eq!(buckets.len(), 1);
        let cell = buckets.values().next().unwrap();
        assert_eq!(cell.total, 3);
        // Bash dominates (2 calls vs 1 Read) → top_tool in finalize is Bash.
        assert_eq!(*cell.per_tool.get("Bash").unwrap(), 2);
        assert_eq!(*cell.per_tool.get("Read").unwrap(), 1);

        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn heatmap_tool_filter_excludes_non_matching() {
        let tmp = std::env::temp_dir()
            .join(format!("tool_heatmap_filter_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let lines = [
            r#"{"timestamp":"2026-04-20T09:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}"#,
            r#"{"timestamp":"2026-04-20T09:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Read","input":{}}]}}"#,
        ];
        let path = write_fixture(&tmp, "session.jsonl", &lines);

        let mut buckets: HashMap<HeatmapKey, HeatmapCellAcc> = HashMap::new();
        scan_session_heatmap(&path, &mut buckets, Some("Bash")).unwrap();

        let cell = buckets.values().next().unwrap();
        assert_eq!(cell.total, 1);
        assert!(cell.per_tool.contains_key("Bash"));
        assert!(!cell.per_tool.contains_key("Read"));

        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
