use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::analysis::chunk_builder;
use crate::cache::SessionCache;
use crate::commands::claude_root::ClaudeRoot;
use crate::commands::path_util::{resolve_session_path, validate_session_id_pair};
use crate::discovery::{
    path_decoder, project_scanner, session_lister,
    subproject_registry::SubprojectRegistry,
};
use crate::parsing::session_parser;
use crate::types::domain::SessionsPaginationOptions;
use crate::watcher;

#[tauri::command]
pub fn search_sessions(
    project_id: String,
    query: String,
    max_results: Option<usize>,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
    _cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let limit = max_results.unwrap_or(50);
    let query_lower = query.to_lowercase();

    let opts = SessionsPaginationOptions::default();
    let reg = registry.lock().map_err(|e| e.to_string())?;
    let all = session_lister::list_sessions_paginated(
        &projects_dir, &claude_dir, &project_id, None, 10000, &opts, &reg,
    )?;

    let mut results = Vec::new();

    for session in &all.sessions {
        if results.len() >= limit {
            break;
        }

        let matches = session
            .first_message
            .as_ref()
            .map(|fm| fm.to_lowercase().contains(&query_lower))
            .unwrap_or(false);

        if matches {
            results.push(serde_json::json!({
                "sessionId": session.id,
                "projectId": session.project_id,
                "preview": session.first_message,
                "timestamp": session.created_at,
            }));
        }
    }

    Ok(serde_json::json!({
        "results": results,
        "total": results.len(),
        "query": query,
    }))
}

#[tauri::command]
pub fn search_all_projects(
    query: String,
    max_results: Option<usize>,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
    _cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let limit = max_results.unwrap_or(50);
    let query_lower = query.to_lowercase();

    let mut reg = registry.lock().map_err(|e| e.to_string())?;
    let projects = project_scanner::scan_projects(&projects_dir, &mut reg)?;
    drop(reg);

    let mut results = Vec::new();

    for project in &projects {
        if results.len() >= limit {
            break;
        }

        let reg = registry.lock().map_err(|e| e.to_string())?;
        let opts = SessionsPaginationOptions::default();
        if let Ok(all) = session_lister::list_sessions_paginated(
            &projects_dir, &claude_dir, &project.id, None, 1000, &opts, &reg,
        ) {
            for session in &all.sessions {
                if results.len() >= limit {
                    break;
                }
                let matches = session
                    .first_message
                    .as_ref()
                    .map(|fm| fm.to_lowercase().contains(&query_lower))
                    .unwrap_or(false);
                if matches {
                    results.push(serde_json::json!({
                        "sessionId": session.id,
                        "projectId": session.project_id,
                        "preview": session.first_message,
                        "timestamp": session.created_at,
                    }));
                }
            }
        }
    }

    Ok(serde_json::json!({
        "results": results,
        "total": results.len(),
        "query": query,
    }))
}

#[tauri::command]
#[tracing::instrument(
    skip_all,
    fields(
        query_len = query.as_ref().map(|q| q.len()).unwrap_or(0),
        max_results = max_results.unwrap_or(50),
        result_count = tracing::field::Empty,
        elapsed_ms = tracing::field::Empty,
    )
)]
pub fn search_sessions_filtered(
    query: Option<String>,
    max_results: Option<usize>,
    status_filter: Option<String>,
    min_created_at: Option<f64>,
    max_created_at: Option<f64>,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
    _cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<Value, String> {
    let start = std::time::Instant::now();
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let limit = max_results.unwrap_or(50);
    let query_lower = query.as_ref().map(|q| q.to_lowercase());

    let mut reg = registry.lock().map_err(|e| e.to_string())?;
    let projects = project_scanner::scan_projects(&projects_dir, &mut reg)?;
    drop(reg);

    let mut results = Vec::new();

    for project in &projects {
        if results.len() >= limit {
            break;
        }

        let reg = registry.lock().map_err(|e| e.to_string())?;
        let opts = SessionsPaginationOptions::default();
        if let Ok(all) = session_lister::list_sessions_paginated(
            &projects_dir, &claude_dir, &project.id, None, 1000, &opts, &reg,
        ) {
            for session in &all.sessions {
                if results.len() >= limit {
                    break;
                }

                if let Some(min_ts) = min_created_at {
                    if session.created_at < min_ts {
                        continue;
                    }
                }
                if let Some(max_ts) = max_created_at {
                    if session.created_at > max_ts {
                        continue;
                    }
                }

                if let Some(ref status) = status_filter {
                    let is_ongoing = session.is_ongoing.unwrap_or(false);
                    match status.as_str() {
                        "ongoing" if !is_ongoing => continue,
                        "completed" if is_ongoing => continue,
                        _ => {}
                    }
                }

                if let Some(ref ql) = query_lower {
                    if !ql.is_empty() {
                        let text_match =
                            session.first_message.as_ref().map_or(false, |fm| fm.to_lowercase().contains(ql))
                            || session.custom_title.as_ref().map_or(false, |t| t.to_lowercase().contains(ql))
                            || session.agent_name.as_ref().map_or(false, |n| n.to_lowercase().contains(ql))
                            || session.id.to_lowercase().contains(ql);
                        if !text_match {
                            continue;
                        }
                    }
                }

                results.push(serde_json::json!({
                    "sessionId": session.id,
                    "projectId": session.project_id,
                    "projectPath": session.project_path,
                    "preview": session.first_message,
                    "customTitle": session.custom_title,
                    "agentName": session.agent_name,
                    "timestamp": session.created_at,
                    "messageCount": session.message_count,
                    "isOngoing": session.is_ongoing,
                    "hasSubagents": session.has_subagents,
                    "contextConsumption": session.context_consumption,
                }));
            }
        }
    }

    let span = tracing::Span::current();
    span.record("result_count", results.len());
    span.record("elapsed_ms", start.elapsed().as_millis() as u64);

    Ok(serde_json::json!({
        "results": results,
        "total": results.len(),
        "query": query,
    }))
}

#[tauri::command]
pub fn search_session_content(
    project_id: String,
    session_id: String,
    query: String,
    is_regex: Option<bool>,
    case_sensitive: Option<bool>,
    cursor: Option<usize>,
    page_size: Option<usize>,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
    claude_root: tauri::State<'_, ClaudeRoot>,
) -> Result<crate::types::search::ContentSearchResult, String> {
    validate_session_id_pair(&project_id, &session_id)?;
    let cache_key = format!("{project_id}/{session_id}");
    let parsed = {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            cached.clone()
        } else {
            let file_path = resolve_session_path(claude_root.canonical_projects(), &project_id, &session_id)?;
            let session = session_parser::parse_session_file(&file_path)?;
            cache.insert(cache_key, session.clone());
            session
        }
    };

    let chunks = chunk_builder::build_chunks(&parsed.messages, &[]);

    crate::analysis::content_search::search_chunks(
        &chunks,
        &query,
        is_regex.unwrap_or(false),
        case_sensitive.unwrap_or(false),
        cursor,
        page_size,
    )
}
