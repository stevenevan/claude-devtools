// Main analytics aggregation — walks project sessions, buckets by time, computes totals.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{Datelike, NaiveDate};

use crate::discovery::{path_decoder, project_scanner, subproject_registry::SubprojectRegistry};
use crate::watcher;

use super::buckets::{
    bucket_key_for, day_label, granularity_for_days, hour_label, make_empty_bucket, month_label,
    week_label, BucketGranularity,
};
use super::cost::{estimate_cost, model_display_name};
use super::session_scan::scan_session_fast;
use super::types::{
    AnalyticsResponse, ModelUsageEntry, ProjectUsageEntry, ScheduleEventEntry, TimeBucketUsage,
    TopSessionEntry,
};

pub fn compute_analytics(
    days: u32,
    registry: &Arc<Mutex<SubprojectRegistry>>,
) -> Result<AnalyticsResponse, String> {
    let claude_dir =
        watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);

    let days = days.clamp(1, 90);
    let granularity = granularity_for_days(days);

    let projects = {
        let mut reg = registry.lock().map_err(|e| e.to_string())?;
        project_scanner::scan_projects(&projects_dir, &mut reg)?
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;
    let cutoff_ms = now_ms - (days as f64) * 86_400_000.0;

    let mut buckets: Vec<(String, TimeBucketUsage)> = Vec::new();
    build_empty_buckets(granularity, days, now_ms, &mut buckets);

    let bucket_map: HashMap<String, usize> = buckets
        .iter()
        .enumerate()
        .map(|(i, (k, _))| (k.clone(), i))
        .collect();

    let mut project_agg: HashMap<String, (u64, f64, u32)> = HashMap::new();
    let mut model_agg: HashMap<String, (u64, f64, u32)> = HashMap::new();
    let mut schedule_events: Vec<ScheduleEventEntry> = Vec::new();
    let mut top_sessions: Vec<TopSessionEntry> = Vec::new();
    let mut total_tokens: u64 = 0;
    let mut total_cost: f64 = 0.0;
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

        let project_name = &project.name;

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

            let latest_activity = modified_at.max(created_at);
            if latest_activity < cutoff_ms {
                continue;
            }

            let summary = match scan_session_fast(&entry.path()) {
                Some(s) => s,
                None => continue,
            };

            let session_timestamp = summary
                .last_timestamp_ms
                .unwrap_or(modified_at.max(created_at));

            let tok_total =
                summary.input_tokens + summary.output_tokens + summary.cache_read_tokens + summary.cache_creation_tokens;
            let cost = estimate_cost(
                summary.model.as_deref(),
                summary.input_tokens,
                summary.output_tokens,
                summary.cache_read_tokens,
                summary.cache_creation_tokens,
            );

            let bkey = bucket_key_for(granularity, session_timestamp);
            if let Some(&idx) = bucket_map.get(&bkey) {
                let (_, bucket) = &mut buckets[idx];
                bucket.total_tokens += tok_total;
                bucket.input_tokens += summary.input_tokens;
                bucket.output_tokens += summary.output_tokens;
                bucket.cache_read_tokens += summary.cache_read_tokens;
                bucket.cost_usd += cost;
                bucket.session_count += 1;
            }

            let pentry = project_agg.entry(project_name.clone()).or_insert((0, 0.0, 0));
            pentry.0 += tok_total;
            pentry.1 += cost;
            pentry.2 += 1;

            if let Some(ref model) = summary.model {
                let mentry = model_agg.entry(model.clone()).or_insert((0, 0.0, 0));
                mentry.0 += tok_total;
                mentry.1 += cost;
                mentry.2 += 1;
            }

            let session_start = summary.first_timestamp_ms.unwrap_or(created_at);
            if summary.duration_ms > 0.0 {
                let title = summary
                    .custom_title
                    .clone()
                    .or(summary.first_user_text.clone())
                    .unwrap_or_else(|| "Untitled session".to_string());

                schedule_events.push(ScheduleEventEntry {
                    id: session_id.to_string(),
                    project_name: project_name.clone(),
                    session_title: title.clone(),
                    start_time: session_start,
                    end_time: session_start + summary.duration_ms,
                    project_id: base_id.to_string(),
                });

                top_sessions.push(TopSessionEntry {
                    project_name: project_name.clone(),
                    title,
                    total_tokens: tok_total,
                    cost_usd: cost,
                    duration_ms: summary.duration_ms,
                    model: summary.model.clone(),
                });
            }

            total_tokens += tok_total;
            total_cost += cost;
            total_sessions += 1;
        }
    }

    schedule_events.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap_or(std::cmp::Ordering::Equal));

    top_sessions.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    top_sessions.truncate(8);

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
        granularity,
        tool_summary: None,
    })
}

fn build_empty_buckets(
    granularity: BucketGranularity,
    days: u32,
    now_ms: f64,
    buckets: &mut Vec<(String, TimeBucketUsage)>,
) {
    match granularity {
        BucketGranularity::Hourly => {
            let now_secs = (now_ms / 1000.0) as i64;
            let dt = chrono::DateTime::from_timestamp(now_secs, 0).unwrap_or_default();
            let today = dt.date_naive();
            for d in (0..days as i64).rev() {
                let date = today - chrono::Duration::days(d);
                let show_date = days > 1;
                for h in 0..24u32 {
                    let key = format!(
                        "{:04}-{:02}-{:02}-{:02}",
                        date.year(),
                        date.month(),
                        date.day(),
                        h
                    );
                    let label = if show_date {
                        format!("{} {}", date.format("%b %-d"), hour_label(h))
                    } else {
                        hour_label(h)
                    };
                    buckets.push((key.clone(), make_empty_bucket(key, label)));
                }
            }
        }
        BucketGranularity::Daily => {
            for i in (0..days as i64).rev() {
                let secs = ((now_ms - i as f64 * 86_400_000.0) / 1000.0) as i64;
                let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
                let date = dt.date_naive();
                let key = format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day());
                buckets.push((key.clone(), make_empty_bucket(key, day_label(&date))));
            }
        }
        BucketGranularity::Weekly => {
            let now_secs = (now_ms / 1000.0) as i64;
            let today = chrono::DateTime::from_timestamp(now_secs, 0)
                .unwrap_or_default()
                .date_naive();
            let start_date = today - chrono::Duration::days(days as i64 - 1);
            let mut monday =
                start_date - chrono::Duration::days(start_date.weekday().num_days_from_monday() as i64);
            while monday <= today {
                let key = format!("{:04}-W{:02}", monday.year(), monday.iso_week().week());
                buckets.push((key.clone(), make_empty_bucket(key, week_label(&monday))));
                monday += chrono::Duration::days(7);
            }
        }
        BucketGranularity::Monthly => {
            let now_secs = (now_ms / 1000.0) as i64;
            let today = chrono::DateTime::from_timestamp(now_secs, 0)
                .unwrap_or_default()
                .date_naive();
            let start_date = today - chrono::Duration::days(days as i64 - 1);
            let mut cursor = NaiveDate::from_ymd_opt(start_date.year(), start_date.month(), 1)
                .unwrap_or(start_date);
            let end_month =
                NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
            while cursor <= end_month {
                let key = format!("{:04}-{:02}", cursor.year(), cursor.month());
                buckets.push((
                    key.clone(),
                    make_empty_bucket(key, month_label(cursor.year(), cursor.month())),
                ));
                cursor = if cursor.month() == 12 {
                    NaiveDate::from_ymd_opt(cursor.year() + 1, 1, 1).unwrap_or(cursor)
                } else {
                    NaiveDate::from_ymd_opt(cursor.year(), cursor.month() + 1, 1).unwrap_or(cursor)
                };
            }
        }
    }
}
