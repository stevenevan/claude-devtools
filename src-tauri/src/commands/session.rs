//! Tauri command wrappers for the session and search surfaces left for W15.

use std::path::PathBuf;

use serde::Serialize;

use crate::analysis::chunk_builder::build_chunks;
use crate::analysis::content_search::search_chunks;
use crate::config::root::{claude_dir, projects_dir};
use crate::discovery::{
    path_decoder, project_scanner, session_lister, subproject_registry::SubprojectRegistry,
};
use crate::parsing::session_parser;
use crate::pipeline;
use crate::types::chunks::SessionDetail;
use crate::types::domain::{
    PaginatedSessionsResult, Project, Session, SessionMetrics, SessionsPaginationOptions,
};
use crate::types::search::ContentSearchResult;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResult {
    results: Vec<SessionSearchItem>,
    total: usize,
    query: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSearchItem {
    session_id: String,
    project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
    preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    custom_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_name: Option<String>,
    timestamp: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    message_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_ongoing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_subagents: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_consumption: Option<u64>,
}

fn validate_ids(project_id: &str, session_id: &str) -> Result<(), String> {
    if !path_decoder::is_valid_project_id(project_id) {
        return Err("invalid project ID".to_string());
    }
    if !path_decoder::is_valid_session_id(session_id) {
        return Err("invalid session ID".to_string());
    }
    Ok(())
}

fn registry(projects_dir: &std::path::Path) -> Result<SubprojectRegistry, String> {
    let mut registry = SubprojectRegistry::new();
    project_scanner::scan_projects(projects_dir, &mut registry)?;
    Ok(registry)
}

fn sessions_for(
    project_id: &str,
    cursor: Option<&str>,
    limit: usize,
    options: &SessionsPaginationOptions,
) -> Result<PaginatedSessionsResult, String> {
    if !path_decoder::is_valid_project_id(project_id) {
        return Err("invalid project ID".to_string());
    }
    let projects = projects_dir()?;
    let registry = registry(&projects)?;
    session_lister::list_sessions_paginated(
        &projects,
        &claude_dir()?,
        project_id,
        cursor,
        limit,
        options,
        &registry,
    )
}

fn go_default_options() -> SessionsPaginationOptions {
    SessionsPaginationOptions {
        include_total_count: true,
        prefilter_all: false,
        metadata_level: "deep".to_string(),
    }
}

fn session_path(project_id: &str, session_id: &str) -> Result<PathBuf, String> {
    validate_ids(project_id, session_id)?;
    Ok(projects_dir()?
        .join(path_decoder::extract_base_dir(project_id))
        .join(format!("{session_id}.jsonl")))
}

fn contains_ci(value: &str, query_lower: &str) -> bool {
    value.to_lowercase().contains(query_lower)
}

fn full_search_item(session: Session) -> SessionSearchItem {
    SessionSearchItem {
        session_id: session.id,
        project_id: session.project_id,
        project_path: Some(session.project_path),
        preview: session.first_message,
        custom_title: session.custom_title,
        agent_name: session.agent_name,
        timestamp: session.created_at,
        message_count: Some(session.message_count),
        is_ongoing: session.is_ongoing,
        has_subagents: Some(session.has_subagents),
        context_consumption: session.context_consumption,
    }
}

#[tauri::command]
pub fn get_projects() -> Result<Vec<Project>, String> {
    let projects = projects_dir()?;
    project_scanner::scan_projects(&projects, &mut SubprojectRegistry::new())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_sessions(project_id: String) -> Result<Vec<Session>, String> {
    Ok(sessions_for(&project_id, None, 10_000, &go_default_options())?.sessions)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_sessions_paginated(
    project_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
    options: Option<SessionsPaginationOptions>,
) -> Result<PaginatedSessionsResult, String> {
    sessions_for(
        &project_id,
        cursor.as_deref(),
        limit.unwrap_or(20).min(100),
        &options.unwrap_or_else(go_default_options),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_sessions_by_ids(
    project_id: String,
    session_ids: Vec<String>,
) -> Result<Vec<Session>, String> {
    let wanted: std::collections::HashSet<_> = session_ids.into_iter().collect();
    Ok(get_sessions(project_id)?
        .into_iter()
        .filter(|session| wanted.contains(&session.id))
        .collect())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_session_detail_incremental(
    project_id: String,
    session_id: String,
) -> Result<Option<SessionDetail>, String> {
    Ok(Some(pipeline::get_session_detail(
        &project_id,
        &session_id,
    )?))
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_session_metrics(
    project_id: String,
    session_id: String,
) -> Result<Option<SessionMetrics>, String> {
    let parsed = session_parser::parse_session_file(&session_path(&project_id, &session_id)?)?;
    Ok(Some(parsed.metrics))
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_waterfall_data(
    project_id: String,
    session_id: String,
) -> Result<Option<SessionDetail>, String> {
    Ok(Some(pipeline::get_session_detail(
        &project_id,
        &session_id,
    )?))
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_subagent_detail(
    project_id: String,
    session_id: String,
    subagent_id: String,
) -> Result<Option<SessionDetail>, String> {
    validate_ids(&project_id, &session_id)?;
    if !path_decoder::is_valid_session_id(&subagent_id) {
        return Err("invalid subagent ID".to_string());
    }
    let base = projects_dir()?.join(path_decoder::extract_base_dir(&project_id));
    let current = base
        .join(&session_id)
        .join("subagents")
        .join(format!("{subagent_id}.jsonl"));
    let legacy = base.join(format!("agent_{subagent_id}.jsonl"));
    let path = if current.exists() { current } else { legacy };
    if !path.exists() {
        return Ok(None);
    }
    let parsed = session_parser::parse_session_file(&path)?;
    let session = Session {
        id: subagent_id,
        project_id: project_id.clone(),
        project_path: path_decoder::decode_path(path_decoder::extract_base_dir(&project_id)),
        todo_data: None,
        created_at: 0.0,
        first_message: None,
        message_timestamp: None,
        has_subagents: false,
        message_count: parsed.messages.len() as u32,
        is_ongoing: Some(false),
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
        custom_title: None,
        agent_name: None,
    };
    Ok(Some(crate::analysis::chunk_builder::build_session_detail(
        session,
        parsed.messages,
        Vec::new(),
    )))
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_session_groups(
    project_id: String,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    validate_ids(&project_id, &session_id)?;
    Ok(Vec::new())
}

#[tauri::command]
pub fn get_repository_groups() -> Result<Vec<serde_json::Value>, String> {
    Ok(Vec::new())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_worktree_sessions(worktree_id: String) -> Result<Vec<Session>, String> {
    if worktree_id.is_empty() || worktree_id.len() > 200 {
        return Err("invalid worktree ID".to_string());
    }
    Ok(Vec::new())
}

#[tauri::command(rename_all = "camelCase")]
pub fn search_sessions(
    project_id: String,
    query: String,
    max_results: Option<usize>,
) -> Result<SessionSearchResult, String> {
    let query_lower = query.to_lowercase();
    let results = get_sessions(project_id)?
        .into_iter()
        .filter(|session| {
            session
                .first_message
                .as_deref()
                .is_some_and(|message| contains_ci(message, &query_lower))
        })
        .take(max_results.unwrap_or(50))
        .map(|session| SessionSearchItem {
            session_id: session.id,
            project_id: session.project_id,
            project_path: None,
            preview: session.first_message,
            custom_title: None,
            agent_name: None,
            timestamp: session.created_at,
            message_count: None,
            is_ongoing: None,
            has_subagents: None,
            context_consumption: None,
        })
        .collect::<Vec<_>>();
    Ok(SessionSearchResult {
        total: results.len(),
        results,
        query: Some(query),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn search_all_projects(
    query: String,
    max_results: Option<usize>,
) -> Result<SessionSearchResult, String> {
    let limit = max_results.unwrap_or(50);
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    for project in get_projects()? {
        if results.len() >= limit {
            break;
        }
        for session in get_sessions(project.id)? {
            if results.len() >= limit {
                break;
            }
            if session
                .first_message
                .as_deref()
                .is_some_and(|message| contains_ci(message, &query_lower))
            {
                results.push(SessionSearchItem {
                    session_id: session.id,
                    project_id: session.project_id,
                    project_path: None,
                    preview: session.first_message,
                    custom_title: None,
                    agent_name: None,
                    timestamp: session.created_at,
                    message_count: None,
                    is_ongoing: None,
                    has_subagents: None,
                    context_consumption: None,
                });
            }
        }
    }
    Ok(SessionSearchResult {
        total: results.len(),
        results,
        query: Some(query),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn search_sessions_filtered(
    query: Option<String>,
    max_results: Option<usize>,
    status_filter: Option<String>,
    min_created_at: Option<f64>,
    max_created_at: Option<f64>,
) -> Result<SessionSearchResult, String> {
    let limit = max_results.unwrap_or(50);
    let query_lower = query.as_deref().unwrap_or_default().to_lowercase();
    let mut results = Vec::new();
    for project in get_projects()? {
        if results.len() >= limit {
            break;
        }
        for session in get_sessions(project.id)? {
            if results.len() >= limit {
                break;
            }
            if min_created_at.is_some_and(|value| session.created_at < value)
                || max_created_at.is_some_and(|value| session.created_at > value)
            {
                continue;
            }
            let ongoing = session.is_ongoing.unwrap_or(false);
            if status_filter.as_deref() == Some("ongoing") && !ongoing
                || status_filter.as_deref() == Some("completed") && ongoing
            {
                continue;
            }
            if !query_lower.is_empty()
                && ![
                    session.first_message.as_deref(),
                    session.custom_title.as_deref(),
                    session.agent_name.as_deref(),
                    Some(session.id.as_str()),
                ]
                .into_iter()
                .flatten()
                .any(|value| contains_ci(value, &query_lower))
            {
                continue;
            }
            results.push(full_search_item(session));
        }
    }
    Ok(SessionSearchResult {
        total: results.len(),
        results,
        query,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn search_session_content(
    project_id: String,
    session_id: String,
    query: String,
    is_regex: Option<bool>,
    case_sensitive: Option<bool>,
    cursor: Option<usize>,
    page_size: Option<usize>,
) -> Result<ContentSearchResult, String> {
    let parsed = session_parser::parse_session_file(&session_path(&project_id, &session_id)?)?;
    search_chunks(
        &build_chunks(&parsed.messages, &[]),
        &query,
        is_regex.unwrap_or(false),
        case_sensitive.unwrap_or(false),
        cursor,
        page_size,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn session_scroll_to_line(session_id: String, _line_number: u32) -> Result<(), String> {
    if !path_decoder::is_valid_session_id(&session_id) {
        return Err("invalid session scroll target".to_string());
    }
    Ok(())
}
