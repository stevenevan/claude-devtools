// Per-model aggregated metrics — cost/token, tokens/session, tool-calls/session,
// error rate, and rough response latency (active_ms / assistant_messages).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Datelike;
use serde::{Deserialize, Serialize};

use crate::discovery::{path_decoder, project_scanner, subproject_registry::SubprojectRegistry};
use crate::watcher;

use super::cost::{estimate_cost, model_display_name};
use super::session_scan::scan_session_fast;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelComparisonEntry {
    pub model: String,
    pub display_name: String,
    /// e.g. "opus" / "sonnet" / "haiku" / "other" — used for grouping sparklines.
    pub family: String,
    pub session_count: u32,
    pub total_tokens: u64,
    pub total_cost_usd: f64,
    pub tokens_per_session: u64,
    pub cost_per_session: f64,
    pub cost_per_million_tokens: f64,
    pub tool_calls_per_session: f64,
    pub error_rate: f64,
    pub avg_response_ms: f64,
    /// 7-day daily session counts (newest last) for per-model sparkline.
    pub daily_sessions: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelComparisonResponse {
    pub models: Vec<ModelComparisonEntry>,
    pub total_sessions: u32,
}

#[derive(Default)]
struct ModelAccumulator {
    session_count: u32,
    total_tokens: u64,
    total_input: u64,
    total_output: u64,
    total_cache_read: u64,
    total_cache_create: u64,
    total_cost: f64,
    tool_calls: u64,
    tool_errors: u64,
    assistant_messages: u64,
    active_ms_total: f64,
    /// Daily session count map (date string → count).
    per_day: HashMap<String, u32>,
}

fn family_for(model: &str) -> &'static str {
    let lower = model.to_lowercase();
    if lower.contains("opus") {
        "opus"
    } else if lower.contains("sonnet") {
        "sonnet"
    } else if lower.contains("haiku") {
        "haiku"
    } else {
        "other"
    }
}

fn day_key(ms: f64) -> Option<String> {
    let secs = (ms / 1000.0) as i64;
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|dt| format!("{:04}-{:02}-{:02}", dt.year(), dt.month(), dt.day()))
}

pub fn compute_model_comparison(
    days: u32,
    registry: &Arc<Mutex<SubprojectRegistry>>,
) -> Result<ModelComparisonResponse, String> {
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

    // Pre-seed the 7 most recent day keys so sparklines are always the same
    // length regardless of activity.
    let mut sparkline_keys: Vec<String> = Vec::with_capacity(7);
    let now_secs = (now_ms / 1000.0) as i64;
    let today = chrono::DateTime::from_timestamp(now_secs, 0)
        .map(|dt| dt.date_naive())
        .unwrap_or_default();
    for i in (0..7i64).rev() {
        let d = today - chrono::Duration::days(i);
        sparkline_keys.push(format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day()));
    }

    let mut acc: HashMap<String, ModelAccumulator> = HashMap::new();
    let mut total_sessions: u32 = 0;
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

            let summary = match scan_session_fast(&entry.path()) {
                Some(s) => s,
                None => continue,
            };

            let model = match summary.model.clone() {
                Some(m) => m,
                None => continue,
            };

            total_sessions += 1;
            let tokens = summary.input_tokens
                + summary.output_tokens
                + summary.cache_read_tokens
                + summary.cache_creation_tokens;
            let cost = estimate_cost(
                Some(model.as_str()),
                summary.input_tokens,
                summary.output_tokens,
                summary.cache_read_tokens,
                summary.cache_creation_tokens,
            );

            let entry_acc = acc.entry(model.clone()).or_default();
            entry_acc.session_count += 1;
            entry_acc.total_tokens += tokens;
            entry_acc.total_input += summary.input_tokens;
            entry_acc.total_output += summary.output_tokens;
            entry_acc.total_cache_read += summary.cache_read_tokens;
            entry_acc.total_cache_create += summary.cache_creation_tokens;
            entry_acc.total_cost += cost;
            entry_acc.tool_calls += summary.tool_call_count;
            entry_acc.tool_errors += summary.tool_error_count;
            entry_acc.assistant_messages += summary.assistant_message_count;
            entry_acc.active_ms_total += summary.active_ms;

            let start_ms = summary.first_timestamp_ms.unwrap_or(modified_ms);
            if let Some(key) = day_key(start_ms) {
                *entry_acc.per_day.entry(key).or_insert(0) += 1;
            }
        }
    }

    let mut models: Vec<ModelComparisonEntry> = acc
        .into_iter()
        .map(|(model, a)| {
            let tokens_per_session = if a.session_count > 0 {
                a.total_tokens / a.session_count as u64
            } else {
                0
            };
            let cost_per_session = if a.session_count > 0 {
                a.total_cost / a.session_count as f64
            } else {
                0.0
            };
            let cost_per_million = if a.total_tokens > 0 {
                (a.total_cost / a.total_tokens as f64) * 1_000_000.0
            } else {
                0.0
            };
            let tool_calls_per_session = if a.session_count > 0 {
                a.tool_calls as f64 / a.session_count as f64
            } else {
                0.0
            };
            let error_rate = if a.tool_calls > 0 {
                a.tool_errors as f64 / a.tool_calls as f64
            } else {
                0.0
            };
            let avg_response_ms = if a.assistant_messages > 0 {
                a.active_ms_total / a.assistant_messages as f64
            } else {
                0.0
            };
            let daily_sessions: Vec<u32> = sparkline_keys
                .iter()
                .map(|k| a.per_day.get(k).copied().unwrap_or(0))
                .collect();

            ModelComparisonEntry {
                family: family_for(&model).to_string(),
                display_name: model_display_name(&model),
                model,
                session_count: a.session_count,
                total_tokens: a.total_tokens,
                total_cost_usd: a.total_cost,
                tokens_per_session,
                cost_per_session,
                cost_per_million_tokens: cost_per_million,
                tool_calls_per_session,
                error_rate,
                avg_response_ms,
                daily_sessions,
            }
        })
        .collect();

    models.sort_by(|a, b| b.session_count.cmp(&a.session_count));

    Ok(ModelComparisonResponse {
        models,
        total_sessions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn family_for_known_models() {
        assert_eq!(family_for("claude-opus-4-6-20260101"), "opus");
        assert_eq!(family_for("claude-sonnet-4-20250514"), "sonnet");
        assert_eq!(family_for("claude-haiku-4-5-20251001"), "haiku");
        assert_eq!(family_for("gpt-4o"), "other");
    }
}
