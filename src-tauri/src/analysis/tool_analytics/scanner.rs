use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

use chrono::{Datelike, Local, TimeZone, Timelike};

use crate::analysis::tokenizer;

use super::shared::{
    heatmap_key, parse_timestamp_ms, tool_result_text, HeatmapCellAcc, HeatmapKey, RawEntry,
    ToolCallStart, ToolStats,
};

/// Scan a single JSONL session, folding tool_use/tool_result pairs into `stats`.
pub(super) fn scan_session(path: &Path, stats: &mut HashMap<String, ToolStats>) -> Option<()> {
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

pub(super) fn bucket_local(ts_ms: f64) -> Option<(u8, u8)> {
    let secs = (ts_ms / 1000.0) as i64;
    let nanos = ((ts_ms - (secs as f64) * 1000.0) * 1_000_000.0).round() as u32;
    let utc = chrono::DateTime::from_timestamp(secs, nanos)?;
    let local = Local.from_utc_datetime(&utc.naive_utc());
    let day = local.weekday().num_days_from_monday() as u8;
    let hour = local.hour() as u8;
    Some((day, hour))
}

/// Walk a session's tool_use blocks, bucketing by local (weekday, hour). When
/// `tool_filter` is `Some`, only matching tool names count.
pub(super) fn scan_session_heatmap(
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
