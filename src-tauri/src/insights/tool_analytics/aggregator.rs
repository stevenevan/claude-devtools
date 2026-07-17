use std::collections::HashMap;
use std::path::PathBuf;

use crate::config::root;
use crate::discovery::path_decoder;

use super::scanner::{scan_session, scan_session_heatmap};
use super::shared::{
    heatmap_key, HeatmapCellAcc, HeatmapKey, ToolAnalyticsResponse, ToolStats, ToolTimeHeatmapCell,
    ToolTimeHeatmapResponse, ToolUsageSummary,
};

pub(super) fn median_u64(samples: &mut [u64]) -> u64 {
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

pub(super) fn finalize(stats: HashMap<String, ToolStats>) -> Vec<ToolUsageSummary> {
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
    let claude_dir = root::claude_dir()?;
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

    // Go's os.ReadDir returns entries sorted by filename; mirror that.
    let mut entries: Vec<_> = std::fs::read_dir(&project_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut stats: HashMap<String, ToolStats> = HashMap::new();
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

    // Go's os.ReadDir returns entries sorted by filename; mirror that.
    let mut entries: Vec<_> = std::fs::read_dir(&project_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut buckets: HashMap<HeatmapKey, HeatmapCellAcc> = HashMap::new();
    // Also collect the full tool name set across the range (ignoring filter)
    // so the dropdown always shows every tool, even if filter removes rows.
    let mut all_tools: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

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
            // Deterministic top tool: max count, tie-break on smallest name
            // (matches Go: `cnt > best || (cnt == best && name < bestName)`).
            let mut best: Option<(&str, u32)> = None;
            for (name, &cnt) in cell.per_tool.iter() {
                match best {
                    Some((bn, bc)) if bc > cnt || (bc == cnt && bn <= name.as_str()) => {}
                    _ => best = Some((name.as_str(), cnt)),
                }
            }
            let top_tool = best.map(|(name, _)| name.to_string());
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
