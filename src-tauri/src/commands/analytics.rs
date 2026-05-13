use std::sync::{Arc, Mutex};

use crate::analysis::summarizer;
use crate::analysis::tokenizer;
use crate::analysis::tool_linking;
use crate::cache::SessionCache;
use crate::commands::path_util::{resolve_session_path, validate_session_id_pair};
use crate::discovery::subproject_registry::SubprojectRegistry;
use crate::parsing::session_parser;
use crate::types::domain::{ParsedSession, SessionMetrics};

#[tauri::command]
pub fn parse_session(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<ParsedSession, String> {
    validate_session_id_pair(&project_id, &session_id)?;
    let cache_key = format!("{project_id}/{session_id}");

    {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let file_path = resolve_session_path(&project_id, &session_id)?;
    let session = session_parser::parse_session_file(&file_path)?;

    {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        cache.insert(cache_key, session.clone());
    }

    Ok(session)
}

#[tauri::command]
pub fn parse_session_metrics(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<SessionMetrics, String> {
    validate_session_id_pair(&project_id, &session_id)?;
    let cache_key = format!("{project_id}/{session_id}");

    {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.metrics.clone());
        }
    }

    let file_path = resolve_session_path(&project_id, &session_id)?;
    let session = session_parser::parse_session_file(&file_path)?;
    let metrics = session.metrics.clone();

    {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        cache.insert(cache_key, session);
    }

    Ok(metrics)
}

#[tauri::command]
pub fn get_analytics(
    days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::AnalyticsResponse, String> {
    crate::analytics::compute_analytics(days, &registry)
}

#[tauri::command]
pub fn get_cost_forecast(
    window_days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::CostForecast, String> {
    crate::analytics::compute_cost_forecast(window_days, &registry)
}

#[tauri::command]
pub fn get_productivity_metrics(
    days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::ProductivityMetrics, String> {
    crate::analytics::compute_productivity_metrics(days, &registry)
}

#[tauri::command]
pub fn get_session_duration_stats(
    days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::SessionDurationResponse, String> {
    crate::analytics::compute_session_duration_stats(days, &registry)
}

#[tauri::command]
pub fn get_model_comparison(
    days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::ModelComparisonResponse, String> {
    crate::analytics::compute_model_comparison(days, &registry)
}

#[tauri::command]
pub fn link_tool_calls(
    steps: Vec<crate::types::chunks::SemanticStep>,
    responses: Option<Vec<tool_linking::ParsedMessageInput>>,
) -> Result<std::collections::HashMap<String, tool_linking::LinkedToolItem>, String> {
    let responses_ref = responses.as_deref();
    Ok(tool_linking::link_tool_calls_to_results(&steps, responses_ref))
}

#[tauri::command]
pub fn count_tokens(text: String) -> Result<usize, String> {
    Ok(tokenizer::count_tokens(&text))
}

#[tauri::command]
pub fn count_tokens_batch(texts: Vec<String>) -> Result<Vec<usize>, String> {
    Ok(tokenizer::count_tokens_batch(&texts))
}

#[tauri::command]
pub fn get_session_tldr(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<summarizer::SessionTldr, String> {
    validate_session_id_pair(&project_id, &session_id)?;
    let cache_key = format!("{project_id}/{session_id}");
    let parsed = {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            cached.clone()
        } else {
            let file_path = resolve_session_path(&project_id, &session_id)?;
            let session = session_parser::parse_session_file(&file_path)?;
            cache.insert(cache_key, session.clone());
            session
        }
    };
    Ok(summarizer::build_session_tldr(&parsed.messages))
}
