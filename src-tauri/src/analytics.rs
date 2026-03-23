/// Analytics aggregation — computes pre-aggregated dashboard data across all projects.
///
/// Called by a single Tauri command; the frontend only assigns colors and renders.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};

use crate::cache::SessionCache;
use crate::discovery::{path_decoder, project_scanner, subproject_registry::SubprojectRegistry};
use crate::parsing::session_parser;
use crate::watcher;

// =============================================================================
// Types returned to the frontend
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeBucketUsage {
    pub key: String,
    pub label: String,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cost_usd: f64,
    pub session_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUsageEntry {
    pub project_name: String,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub session_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageEntry {
    pub model: String,
    pub display_name: String,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub session_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEventEntry {
    pub id: String,
    pub project_name: String,
    pub session_title: String,
    pub start_time: f64,
    pub end_time: f64,
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopSessionEntry {
    pub project_name: String,
    pub title: String,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub duration_ms: f64,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsResponse {
    pub time_buckets: Vec<TimeBucketUsage>,
    pub project_usage: Vec<ProjectUsageEntry>,
    pub model_usage: Vec<ModelUsageEntry>,
    pub schedule_events: Vec<ScheduleEventEntry>,
    pub top_sessions: Vec<TopSessionEntry>,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_sessions: u32,
    pub avg_tokens_per_session: u64,
    pub avg_cost_per_session: f64,
}

// =============================================================================
// Cost estimation (pricing from litellm model_prices_and_context_window.json)
// =============================================================================

struct ModelPricing {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}

/// Resolve per-token pricing for a model string. Falls back to Sonnet pricing.
fn get_model_pricing(model: Option<&str>) -> ModelPricing {
    let model = match model {
        Some(m) => m.to_lowercase(),
        None => {
            return ModelPricing {
                input: 3e-06,
                output: 1.5e-05,
                cache_read: 3e-07,
                cache_write: 3.75e-06,
            };
        }
    };

    // Match by family + version from the model string
    if model.contains("opus") {
        if model.contains("4-5") || model.contains("4.5") || model.contains("4-6") || model.contains("4.6") {
            // Opus 4.5 / 4.6
            ModelPricing { input: 5e-06, output: 2.5e-05, cache_read: 5e-07, cache_write: 6.25e-06 }
        } else {
            // Opus 3 / 4 / 4.1
            ModelPricing { input: 1.5e-05, output: 7.5e-05, cache_read: 1.5e-06, cache_write: 1.875e-05 }
        }
    } else if model.contains("haiku") {
        if model.contains("4-5") || model.contains("4.5") {
            // Haiku 4.5
            ModelPricing { input: 1e-06, output: 5e-06, cache_read: 1e-07, cache_write: 1.25e-06 }
        } else if model.contains("3-5") || model.contains("3.5") {
            // Haiku 3.5
            ModelPricing { input: 8e-07, output: 4e-06, cache_read: 8e-08, cache_write: 1e-06 }
        } else {
            // Haiku 3
            ModelPricing { input: 2.5e-07, output: 1.25e-06, cache_read: 2.5e-08, cache_write: 3.125e-07 }
        }
    } else {
        // Sonnet (default) — covers sonnet 3.5, 4, 4.5, 4.6
        ModelPricing { input: 3e-06, output: 1.5e-05, cache_read: 3e-07, cache_write: 3.75e-06 }
    }
}

fn estimate_cost(
    model: Option<&str>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
) -> f64 {
    let p = get_model_pricing(model);
    (input as f64) * p.input
        + (output as f64) * p.output
        + (cache_read as f64) * p.cache_read
        + (cache_creation as f64) * p.cache_write
}

// =============================================================================
// Model display name
// =============================================================================

fn model_display_name(model: &str) -> String {
    let lower = model.to_lowercase();
    for family in &["opus", "sonnet", "haiku"] {
        if let Some(idx) = lower.find(family) {
            let after = &lower[idx + family.len()..];
            let capitalized = format!("{}{}", &family[..1].to_uppercase(), &family[1..]);

            // Extract version numbers
            let mut major = None;
            let mut minor = None;
            let mut num_iter = after.chars().peekable();
            // Skip non-digit prefix
            while num_iter.peek().is_some_and(|c| !c.is_ascii_digit()) {
                num_iter.next();
            }
            // Read major
            let mut buf = String::new();
            while num_iter.peek().is_some_and(|c| c.is_ascii_digit()) {
                buf.push(num_iter.next().unwrap());
            }
            if !buf.is_empty() {
                major = Some(buf.clone());
                buf.clear();
            }
            // Skip separator
            while num_iter.peek().is_some_and(|c| !c.is_ascii_digit()) {
                num_iter.next();
            }
            // Read minor
            while num_iter.peek().is_some_and(|c| c.is_ascii_digit()) {
                buf.push(num_iter.next().unwrap());
            }
            if !buf.is_empty() && buf.len() <= 2 {
                minor = Some(buf);
            }

            return match (major, minor) {
                (Some(maj), Some(min)) => format!("{capitalized} {maj}.{min}"),
                (Some(maj), None) => format!("{capitalized} {maj}"),
                _ => capitalized,
            };
        }
    }
    // Fallback
    model
        .strip_prefix("claude-")
        .unwrap_or(model)
        .to_string()
}

// =============================================================================
// Time bucket helpers
// =============================================================================

fn day_key(ts_ms: f64) -> String {
    let secs = (ts_ms / 1000.0) as i64;
    let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
    format!("{:04}-{:02}-{:02}", dt.year(), dt.month(), dt.day())
}

fn hour_key(ts_ms: f64) -> String {
    let secs = (ts_ms / 1000.0) as i64;
    let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
    format!(
        "{:04}-{:02}-{:02}-{:02}",
        dt.year(),
        dt.month(),
        dt.day(),
        dt.hour()
    )
}

fn day_label(date: &NaiveDate) -> String {
    date.format("%b %-d").to_string()
}

fn hour_label(h: u32) -> String {
    match h {
        0 => "12 AM".into(),
        h if h < 12 => format!("{h} AM"),
        12 => "12 PM".into(),
        h => format!("{} PM", h - 12),
    }
}

// =============================================================================
// Main analytics function
// =============================================================================

/// Time range passed from the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimeRangeParam {
    Today,
    Week,
    Month,
    #[serde(rename = "3months")]
    ThreeMonths,
}

impl TimeRangeParam {
    fn days(&self) -> i64 {
        match self {
            Self::Today => 1,
            Self::Week => 7,
            Self::Month => 30,
            Self::ThreeMonths => 90,
        }
    }

    fn is_hourly(&self) -> bool {
        matches!(self, Self::Today)
    }
}

pub fn compute_analytics(
    time_range: &TimeRangeParam,
    registry: &Arc<Mutex<SubprojectRegistry>>,
    cache: &Arc<Mutex<SessionCache>>,
) -> Result<AnalyticsResponse, String> {
    let claude_dir =
        watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);

    // Scan all projects
    let projects = {
        let mut reg = registry.lock().map_err(|e| e.to_string())?;
        project_scanner::scan_projects(&projects_dir, &mut reg)?
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;
    let cutoff_ms = now_ms - (time_range.days() as f64) * 86_400_000.0;
    let is_hourly = time_range.is_hourly();

    // Pre-build empty time buckets
    let mut buckets: Vec<(String, TimeBucketUsage)> = Vec::new();
    if is_hourly {
        let now_secs = (now_ms / 1000.0) as i64;
        let dt = chrono::DateTime::from_timestamp(now_secs, 0).unwrap_or_default();
        let today = dt.date_naive();
        for h in 0..24u32 {
            let key = format!("{:04}-{:02}-{:02}-{:02}", today.year(), today.month(), today.day(), h);
            buckets.push((
                key.clone(),
                TimeBucketUsage {
                    key,
                    label: hour_label(h),
                    total_tokens: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cost_usd: 0.0,
                    session_count: 0,
                },
            ));
        }
    } else {
        let days = time_range.days();
        for i in (0..days).rev() {
            let secs = ((now_ms - i as f64 * 86_400_000.0) / 1000.0) as i64;
            let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
            let date = dt.date_naive();
            let key = format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day());
            buckets.push((
                key.clone(),
                TimeBucketUsage {
                    key,
                    label: day_label(&date),
                    total_tokens: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cost_usd: 0.0,
                    session_count: 0,
                },
            ));
        }
    }
    let mut bucket_map: HashMap<String, usize> = buckets
        .iter()
        .enumerate()
        .map(|(i, (k, _))| (k.clone(), i))
        .collect();

    // Aggregation accumulators
    let mut project_agg: HashMap<String, (u64, f64, u32)> = HashMap::new(); // tokens, cost, count
    let mut model_agg: HashMap<String, (u64, f64, u32)> = HashMap::new();
    let mut schedule_events: Vec<ScheduleEventEntry> = Vec::new();
    let mut top_sessions: Vec<TopSessionEntry> = Vec::new();
    let mut total_tokens: u64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut total_sessions: u32 = 0;

    // Deduplicate project directories — composite IDs ("path::hash") share the same
    // filesystem directory as their base project, so we must avoid processing sessions twice.
    let mut seen_dirs = std::collections::HashSet::new();

    // Process each project
    for project in &projects {
        // Strip composite suffix (e.g. "encodedPath::hash" → "encodedPath")
        let base_id = match project.id.find("::") {
            Some(idx) => &project.id[..idx],
            None => &project.id,
        };

        // Skip if we already processed this directory
        if !seen_dirs.insert(base_id.to_string()) {
            continue;
        }

        let project_dir = projects_dir.join(base_id);
        if !project_dir.is_dir() {
            continue;
        }

        // Use the project name for display; for composite projects the first
        // encountered name from the scanner is good enough (it's the dir name).
        let project_name = &project.name;

        // List session files
        let session_files = match std::fs::read_dir(&project_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in session_files.flatten() {
            let fname = entry.file_name();
            let fname = fname.to_string_lossy();
            if !fname.ends_with(".jsonl") {
                continue;
            }
            let session_id = fname.trim_end_matches(".jsonl");

            // Use file modified time for cutoff (session active today was modified today,
            // even if created days ago). Fall back to creation time.
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

            // Include session if it was either created or modified within the time range
            let latest_activity = modified_at.max(created_at);
            if latest_activity < cutoff_ms {
                continue;
            }

            // Parse session (use cache if available)
            let cache_key = format!("{}/{}", project.id, session_id);
            let parsed = {
                let mut c = cache.lock().map_err(|e| e.to_string())?;
                if let Some(cached) = c.get(&cache_key) {
                    cached.clone()
                } else {
                    let file_path = entry.path();
                    match session_parser::parse_session_file(&file_path) {
                        Ok(session) => {
                            c.insert(cache_key, session.clone());
                            session
                        }
                        Err(_) => continue,
                    }
                }
            };

            // Derive session timestamp from message data when available.
            // Use the last message timestamp for bucket placement (when was the session active),
            // falling back to file modified time, then creation time.
            let session_timestamp = parsed
                .messages
                .last()
                .and_then(|msg| chrono::DateTime::parse_from_rfc3339(&msg.timestamp).ok())
                .map(|dt| dt.timestamp_millis() as f64)
                .unwrap_or(modified_at.max(created_at));

            let m = &parsed.metrics;
            let cost = estimate_cost(
                m.model.as_deref(),
                m.input_tokens,
                m.output_tokens,
                m.cache_read_tokens,
                m.cache_creation_tokens,
            );

            // Update time bucket — place in the bucket of the session's last activity
            let bkey = if is_hourly {
                hour_key(session_timestamp)
            } else {
                day_key(session_timestamp)
            };
            if let Some(&idx) = bucket_map.get(&bkey) {
                let (_, bucket) = &mut buckets[idx];
                bucket.total_tokens += m.total_tokens;
                bucket.input_tokens += m.input_tokens;
                bucket.output_tokens += m.output_tokens;
                bucket.cache_read_tokens += m.cache_read_tokens;
                bucket.cost_usd += cost;
                bucket.session_count += 1;
            }

            // Update project aggregation
            let pentry = project_agg.entry(project_name.clone()).or_insert((0, 0.0, 0));
            pentry.0 += m.total_tokens;
            pentry.1 += cost;
            pentry.2 += 1;

            // Update model aggregation
            if let Some(ref model) = m.model {
                let mentry = model_agg.entry(model.clone()).or_insert((0, 0.0, 0));
                mentry.0 += m.total_tokens;
                mentry.1 += cost;
                mentry.2 += 1;
            }

            // Derive session start from first message timestamp (more accurate than file ctime)
            let session_start = parsed
                .messages
                .first()
                .and_then(|msg| chrono::DateTime::parse_from_rfc3339(&msg.timestamp).ok())
                .map(|dt| dt.timestamp_millis() as f64)
                .unwrap_or(created_at);

            // Build schedule event
            if m.duration_ms > 0.0 {
                // Get session title from the preview
                let title = parsed.custom_title.clone().unwrap_or_else(|| {
                    parsed
                        .by_type
                        .real_user
                        .first()
                        .and_then(|msg| match &msg.content {
                            crate::types::messages::ParsedMessageContent::Text(t) => {
                                let trimmed = t.trim();
                                if trimmed.is_empty() {
                                    None
                                } else {
                                    let preview = if trimmed.len() > 100 {
                                        let mut end = 100;
                                        while !trimmed.is_char_boundary(end) {
                                            end -= 1;
                                        }
                                        format!("{}...", &trimmed[..end])
                                    } else {
                                        trimmed.to_string()
                                    };
                                    Some(preview)
                                }
                            }
                            _ => None,
                        })
                        .unwrap_or_else(|| "Untitled session".to_string())
                });

                schedule_events.push(ScheduleEventEntry {
                    id: session_id.to_string(),
                    project_name: project_name.clone(),
                    session_title: title.clone(),
                    start_time: session_start,
                    end_time: session_start + m.duration_ms,
                    project_id: base_id.to_string(),
                });

                top_sessions.push(TopSessionEntry {
                    project_name: project_name.clone(),
                    title,
                    total_tokens: m.total_tokens,
                    cost_usd: cost,
                    duration_ms: m.duration_ms,
                    model: m.model.clone(),
                });
            }

            total_tokens += m.total_tokens;
            total_cost += cost;
            total_sessions += 1;
        }
    }

    // Sort schedule events by start time
    schedule_events.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap_or(std::cmp::Ordering::Equal));

    // Sort top sessions by tokens descending, take top 8
    top_sessions.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    top_sessions.truncate(8);

    // Build sorted project usage
    let mut project_usage: Vec<ProjectUsageEntry> = project_agg
        .into_iter()
        .map(|(name, (tokens, cost, count))| ProjectUsageEntry {
            project_name: name,
            total_tokens: tokens,
            cost_usd: cost,
            session_count: count,
        })
        .collect();
    project_usage.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    // Build sorted model usage
    let mut model_usage: Vec<ModelUsageEntry> = model_agg
        .into_iter()
        .map(|(model, (tokens, cost, count))| ModelUsageEntry {
            display_name: model_display_name(&model),
            model,
            total_tokens: tokens,
            cost_usd: cost,
            session_count: count,
        })
        .collect();
    model_usage.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    let avg_tokens = if total_sessions > 0 {
        total_tokens / total_sessions as u64
    } else {
        0
    };
    let avg_cost = if total_sessions > 0 {
        total_cost / total_sessions as f64
    } else {
        0.0
    };

    Ok(AnalyticsResponse {
        time_buckets: buckets.into_iter().map(|(_, b)| b).collect(),
        project_usage,
        model_usage,
        schedule_events,
        top_sessions,
        total_tokens,
        total_cost,
        total_sessions,
        avg_tokens_per_session: avg_tokens,
        avg_cost_per_session: avg_cost,
    })
}
