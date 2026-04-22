// Productivity metrics — per-day KPIs for sessions started/completed, active
// minutes, tool calls, and token distribution percentiles.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::discovery::{path_decoder, project_scanner, subproject_registry::SubprojectRegistry};
use crate::watcher;

use super::session_scan::scan_session_fast;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityDay {
    pub date: String,
    pub sessions_started: u32,
    pub sessions_completed: u32,
    pub active_ms: f64,
    pub tool_calls: u64,
    pub tokens_p50: u64,
    pub tokens_p95: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityTotals {
    pub sessions_started: u32,
    pub sessions_completed: u32,
    pub active_ms: f64,
    pub tool_calls: u64,
    pub tokens_p50: u64,
    pub tokens_p95: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityMetrics {
    pub days: Vec<ProductivityDay>,
    pub totals: ProductivityTotals,
}

/// Compute percentile of a sorted ascending `u64` slice. Empty → 0.
pub fn percentile_u64(sorted: &[u64], pct: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let p = pct.clamp(0.0, 1.0);
    let len = sorted.len();
    let idx = ((len as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(len - 1)]
}

fn day_key_ms(ms: f64) -> Option<String> {
    let secs = (ms / 1000.0) as i64;
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|dt| format!("{:04}-{:02}-{:02}", dt.year(), dt.month(), dt.day()))
}

pub fn compute_productivity_metrics(
    days: u32,
    registry: &Arc<Mutex<SubprojectRegistry>>,
) -> Result<ProductivityMetrics, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);

    let days = days.clamp(1, 90);

    let projects = {
        let mut reg = registry.lock().map_err(|e| e.to_string())?;
        project_scanner::scan_projects(&projects_dir, &mut reg)?
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;
    let cutoff_ms = now_ms - (days as f64) * 86_400_000.0;

    // Seed empty day buckets for the requested range so sparklines have a full
    // timeline even if some days are idle.
    let mut day_buckets: HashMap<String, DayAccumulator> = HashMap::new();
    let now_secs = (now_ms / 1000.0) as i64;
    let today = chrono::DateTime::from_timestamp(now_secs, 0)
        .map(|dt| dt.date_naive())
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(1970, 1, 1).unwrap_or_default());
    let mut ordered_keys: Vec<String> = Vec::with_capacity(days as usize);
    for i in (0..days as i64).rev() {
        let d = today - chrono::Duration::days(i);
        let key = format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day());
        ordered_keys.push(key.clone());
        day_buckets.entry(key).or_default();
    }

    let mut seen_dirs = std::collections::HashSet::new();

    for project in &projects {
        let base_id = match project.id.find("::") {
            Some(idx) => &project.id[..idx],
            None => &project.id,
        };
        if !seen_dirs.insert(base_id.to_string()) {
            continue;
        }

        let project_dir = projects_dir.join(base_id);
        if !project_dir.is_dir() {
            continue;
        }

        let entries = match std::fs::read_dir(&project_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let fname = entry.file_name();
            let fname = fname.to_string_lossy();
            if !fname.ends_with(".jsonl") {
                continue;
            }

            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            let created_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.created().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            let latest = modified_at.max(created_at);
            if latest < cutoff_ms {
                continue;
            }

            let summary = match scan_session_fast(&entry.path()) {
                Some(s) => s,
                None => continue,
            };

            let start_ms = summary.first_timestamp_ms.unwrap_or(created_at);
            let end_ms = summary.last_timestamp_ms.unwrap_or(latest);

            let started_key = day_key_ms(start_ms);
            let completed_key = if summary.duration_ms > 0.0 {
                day_key_ms(end_ms)
            } else {
                None
            };

            if let Some(key) = started_key {
                let bucket = day_buckets.entry(key).or_default();
                bucket.sessions_started += 1;
                bucket.active_ms += summary.active_ms;
                bucket.tool_calls += summary.tool_call_count;
                let tokens = summary.input_tokens
                    + summary.output_tokens
                    + summary.cache_read_tokens
                    + summary.cache_creation_tokens;
                bucket.tokens.push(tokens);
            }

            if let Some(key) = completed_key {
                let bucket = day_buckets.entry(key).or_default();
                bucket.sessions_completed += 1;
            }
        }
    }

    // Build the days array in chronological order (oldest → newest).
    let mut days_out: Vec<ProductivityDay> = Vec::with_capacity(ordered_keys.len());
    let mut all_tokens: Vec<u64> = Vec::new();
    let mut totals = ProductivityTotals {
        sessions_started: 0,
        sessions_completed: 0,
        active_ms: 0.0,
        tool_calls: 0,
        tokens_p50: 0,
        tokens_p95: 0,
    };

    for key in ordered_keys {
        let bucket = day_buckets.remove(&key).unwrap_or_default();
        let mut sorted = bucket.tokens.clone();
        sorted.sort_unstable();
        let tokens_p50 = percentile_u64(&sorted, 0.5);
        let tokens_p95 = percentile_u64(&sorted, 0.95);

        totals.sessions_started += bucket.sessions_started;
        totals.sessions_completed += bucket.sessions_completed;
        totals.active_ms += bucket.active_ms;
        totals.tool_calls += bucket.tool_calls;
        all_tokens.extend_from_slice(&sorted);

        days_out.push(ProductivityDay {
            date: key,
            sessions_started: bucket.sessions_started,
            sessions_completed: bucket.sessions_completed,
            active_ms: bucket.active_ms,
            tool_calls: bucket.tool_calls,
            tokens_p50,
            tokens_p95,
        });
    }

    all_tokens.sort_unstable();
    totals.tokens_p50 = percentile_u64(&all_tokens, 0.5);
    totals.tokens_p95 = percentile_u64(&all_tokens, 0.95);

    Ok(ProductivityMetrics {
        days: days_out,
        totals,
    })
}

#[derive(Default)]
struct DayAccumulator {
    sessions_started: u32,
    sessions_completed: u32,
    active_ms: f64,
    tool_calls: u64,
    tokens: Vec<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_empty_zero() {
        assert_eq!(percentile_u64(&[], 0.5), 0);
    }

    #[test]
    fn percentile_median() {
        let data: Vec<u64> = vec![1, 2, 3, 4, 5];
        assert_eq!(percentile_u64(&data, 0.5), 3);
    }

    #[test]
    fn percentile_p95_small_sample_rounds() {
        let data: Vec<u64> = vec![10, 20, 30, 40, 50];
        assert_eq!(percentile_u64(&data, 0.95), 50);
    }

    #[test]
    fn percentile_clamps_upper() {
        let data: Vec<u64> = vec![7];
        assert_eq!(percentile_u64(&data, 0.99), 7);
    }
}
