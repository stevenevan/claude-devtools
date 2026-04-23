// Per-session duration analytics — wall-clock and gap-adjusted active duration.
// Emits p50/p95/max aggregates and an outlier list (sessions exceeding p95 by
// 1.5x) that the dashboard panel and sidebar badge consume.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::discovery::{path_decoder, project_scanner, subproject_registry::SubprojectRegistry};
use crate::watcher;

use super::session_scan::scan_session_fast;

/// Multiplier above p95 that marks a session as an outlier.
pub const OUTLIER_FACTOR: f64 = 1.5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDurationEntry {
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub title: String,
    pub wall_ms: f64,
    pub active_ms: f64,
    pub started_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurationStats {
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub max_ms: f64,
    pub outlier_threshold_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDurationResponse {
    /// All sessions in the range with both wall-clock and active durations.
    pub sessions: Vec<SessionDurationEntry>,
    /// Histogram bucket counts (wall-clock). 12 fixed-width buckets between 0
    /// and `histogram_max_ms`.
    pub histogram: Vec<u32>,
    pub histogram_max_ms: f64,
    pub wall_stats: DurationStats,
    pub active_stats: DurationStats,
    pub outlier_session_ids: Vec<String>,
}

pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let clamped = p.clamp(0.0, 1.0);
    let idx = ((sorted.len() as f64 - 1.0) * clamped).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn compute_stats(sorted: &[f64]) -> DurationStats {
    let p50 = percentile(sorted, 0.5);
    let p95 = percentile(sorted, 0.95);
    let max = sorted.last().copied().unwrap_or(0.0);
    DurationStats {
        p50_ms: p50,
        p95_ms: p95,
        max_ms: max,
        outlier_threshold_ms: p95 * OUTLIER_FACTOR,
    }
}

fn build_histogram(values: &[f64], max_ms: f64, bucket_count: usize) -> Vec<u32> {
    if bucket_count == 0 || max_ms <= 0.0 {
        return vec![0; bucket_count.max(1)];
    }
    let bucket_width = max_ms / bucket_count as f64;
    let mut buckets = vec![0u32; bucket_count];
    for v in values {
        if *v <= 0.0 {
            buckets[0] += 1;
            continue;
        }
        let idx = ((*v / bucket_width) as usize).min(bucket_count - 1);
        buckets[idx] += 1;
    }
    buckets
}

pub fn compute_session_duration_stats(
    days: u32,
    registry: &Arc<Mutex<SubprojectRegistry>>,
) -> Result<SessionDurationResponse, String> {
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

    let mut sessions: Vec<SessionDurationEntry> = Vec::new();
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
            let session_id = fname.trim_end_matches(".jsonl").to_string();

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

            if summary.duration_ms <= 0.0 && summary.active_ms <= 0.0 {
                continue;
            }

            let title = summary
                .custom_title
                .clone()
                .or(summary.first_user_text.clone())
                .unwrap_or_else(|| "Untitled session".to_string());
            let started_ms = summary.first_timestamp_ms.unwrap_or(modified_ms);

            sessions.push(SessionDurationEntry {
                session_id,
                project_id: base_id.to_string(),
                project_name: project.name.clone(),
                title,
                wall_ms: summary.duration_ms,
                active_ms: summary.active_ms,
                started_ms,
            });
        }
    }

    let mut wall_sorted: Vec<f64> = sessions.iter().map(|s| s.wall_ms).collect();
    wall_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut active_sorted: Vec<f64> = sessions.iter().map(|s| s.active_ms).collect();
    active_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let wall_stats = compute_stats(&wall_sorted);
    let active_stats = compute_stats(&active_sorted);

    let histogram_max_ms = if wall_stats.max_ms > 0.0 {
        wall_stats.max_ms
    } else {
        1.0
    };
    let histogram = build_histogram(&wall_sorted, histogram_max_ms, 12);

    let outlier_threshold = wall_stats.outlier_threshold_ms;
    let mut outlier_session_ids: Vec<String> = sessions
        .iter()
        .filter(|s| outlier_threshold > 0.0 && s.wall_ms > outlier_threshold)
        .map(|s| s.session_id.clone())
        .collect();
    outlier_session_ids.sort();

    // Send most-recent first so the panel's outlier list reads chronologically.
    sessions.sort_by(|a, b| b.started_ms.partial_cmp(&a.started_ms).unwrap_or(std::cmp::Ordering::Equal));

    Ok(SessionDurationResponse {
        sessions,
        histogram,
        histogram_max_ms,
        wall_stats,
        active_stats,
        outlier_session_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_median_and_p95() {
        let data: Vec<f64> = (1..=100).map(|v| v as f64).collect();
        // round((100-1) * 0.5) = 50 → data[50] = 51
        assert!((percentile(&data, 0.5) - 51.0).abs() < 1e-9);
        // round((100-1) * 0.95) = round(94.05) = 94 → data[94] = 95
        assert!((percentile(&data, 0.95) - 95.0).abs() < 1e-9);
    }

    #[test]
    fn percentile_single_sample() {
        assert_eq!(percentile(&[42.0], 0.95), 42.0);
        assert_eq!(percentile(&[], 0.5), 0.0);
    }

    #[test]
    fn histogram_distributes_values_across_buckets() {
        // Bucket width = 10 for 10 buckets over [0, 100].
        // Indices: 0→0 (short-circuit), 10→1, 25→2, 45→4, 60→6, 95→9.
        let values = vec![0.0, 10.0, 25.0, 45.0, 60.0, 95.0];
        let buckets = build_histogram(&values, 100.0, 10);
        assert_eq!(buckets[0], 1);
        assert_eq!(buckets[1], 1);
        assert_eq!(buckets[2], 1);
        assert_eq!(buckets[4], 1);
        assert_eq!(buckets[6], 1);
        assert_eq!(buckets[9], 1);
        assert_eq!(buckets.iter().sum::<u32>(), values.len() as u32);
    }

    #[test]
    fn compute_stats_sets_outlier_threshold_factor() {
        let mut sorted: Vec<f64> = (1..=20).map(|v| v as f64 * 1000.0).collect();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let stats = compute_stats(&sorted);
        // p95 of 1..20 = round(19 * 0.95) = 18 → data[18] = 19_000
        assert!((stats.p95_ms - 19_000.0).abs() < 1e-9);
        assert!(
            (stats.outlier_threshold_ms - 19_000.0 * OUTLIER_FACTOR).abs() < 1e-9,
            "got {}",
            stats.outlier_threshold_ms
        );
    }
}
