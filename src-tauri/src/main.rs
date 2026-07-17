// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::State;

use claude_devtools_lib::analytics::{
    compute_analytics, compute_cost_forecast, compute_model_comparison,
    compute_productivity_metrics, compute_session_duration_stats, AnalyticsResponse, CostForecast,
    ModelComparisonResponse, ProductivityMetrics, SessionDurationResponse,
};
use claude_devtools_lib::cache::SessionCache;
use claude_devtools_lib::pipeline;
use claude_devtools_lib::timing::{summarize, CacheStats, PercentileSummary, TimingBuffer};
use claude_devtools_lib::types::chunks::SessionDetail;

// Shared managed state, mirroring the Go service layer: one SessionCache
// singleton (timingservice holds a ref) + one TimingBuffer.
type SharedCache = Arc<Mutex<SessionCache>>;
type SharedTiming = Arc<TimingBuffer>;

// First real Tauri command (W7): the in-app session-detail load. Mirrors the
// frozen WailsAPI `getSessionDetail(projectId, sessionId) => SessionDetail | null`.
#[tauri::command(rename_all = "camelCase")]
fn get_session_detail(project_id: String, session_id: String) -> Result<Option<SessionDetail>, String> {
    pipeline::get_session_detail(&project_id, &session_id).map(Some)
}

// ── W8 analytics commands (stateless — analyticsservice.Get* → Compute*) ──────

#[tauri::command(rename_all = "camelCase")]
fn get_analytics(days: u32) -> Result<AnalyticsResponse, String> {
    compute_analytics(days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_cost_forecast(window_days: u32) -> Result<CostForecast, String> {
    compute_cost_forecast(window_days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_productivity_metrics(days: u32) -> Result<ProductivityMetrics, String> {
    compute_productivity_metrics(days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_session_duration_stats(days: u32) -> Result<SessionDurationResponse, String> {
    compute_session_duration_stats(days)
}

#[tauri::command(rename_all = "camelCase")]
fn get_model_comparison(days: u32) -> Result<ModelComparisonResponse, String> {
    compute_model_comparison(days)
}

// ── W8 timing / cache commands (timingservice) ───────────────────────────────

#[tauri::command(rename_all = "camelCase")]
fn get_backend_timings(
    limit: Option<usize>,
    timing: State<'_, SharedTiming>,
) -> Result<Vec<PercentileSummary>, String> {
    let entries = timing.snapshot(limit);
    Ok(summarize(&entries))
}

#[tauri::command(rename_all = "camelCase")]
fn get_cache_stats(cache: State<'_, SharedCache>) -> Result<CacheStats, String> {
    let guard = cache.lock().map_err(|e| e.to_string())?;
    let total = guard.hits + guard.misses;
    let hit_rate = if total == 0 {
        0.0
    } else {
        guard.hits as f64 / total as f64
    };
    Ok(CacheStats {
        capacity: guard.capacity(),
        size: guard.len(),
        hits: guard.hits,
        misses: guard.misses,
        evicts: guard.evicts,
        hit_rate,
    })
}

#[tauri::command(rename_all = "camelCase")]
fn set_cache_capacity(capacity: usize, cache: State<'_, SharedCache>) -> Result<(), String> {
    cache.lock().map_err(|e| e.to_string())?.set_capacity(capacity);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn clear_session_cache(cache: State<'_, SharedCache>) -> Result<(), String> {
    cache.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

fn main() {
    // Go defaults (cache.go:27-28): capacity 50, ttl 600s.
    let cache: SharedCache = Arc::new(Mutex::new(SessionCache::new(50, Duration::from_secs(600))));
    let timing: SharedTiming = Arc::new(TimingBuffer::default());

    tauri::Builder::default()
        .manage(cache)
        .manage(timing)
        .invoke_handler(tauri::generate_handler![
            get_session_detail,
            get_analytics,
            get_cost_forecast,
            get_productivity_metrics,
            get_session_duration_stats,
            get_model_comparison,
            get_backend_timings,
            get_cache_stats,
            set_cache_capacity,
            clear_session_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
