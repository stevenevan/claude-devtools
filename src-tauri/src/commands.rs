use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::cache::SessionCache;
use crate::discovery::{
    path_decoder, project_scanner, session_lister, subproject_registry::SubprojectRegistry,
};
use crate::parsing::session_parser;
use crate::sidecar::SidecarState;
use crate::types::domain::{
    PaginatedSessionsResult, ParsedSession, Project, SessionMetrics, SessionsPaginationOptions,
};
use crate::watcher;

// ---------------------------------------------------------------------------
// Sidecar & App
// ---------------------------------------------------------------------------

/// Returns the port the sidecar HTTP server is listening on.
#[tauri::command]
pub fn get_sidecar_port(state: tauri::State<'_, Mutex<SidecarState>>) -> Result<u16, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    if state.port == 0 {
        return Err("Sidecar not started yet".to_string());
    }
    Ok(state.port)
}

/// Returns the app version from Cargo.toml.
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---------------------------------------------------------------------------
// File Watching
// ---------------------------------------------------------------------------

/// Start watching ~/.claude/projects/ and ~/.claude/todos/ for changes.
#[tauri::command]
pub fn start_watching(app: tauri::AppHandle) -> Result<(), String> {
    watcher::start_watcher(&app)
}

/// Stop file watching.
#[tauri::command]
pub fn stop_watching(app: tauri::AppHandle) -> Result<(), String> {
    watcher::stop_watcher(&app)
}

// ---------------------------------------------------------------------------
// Session Parsing
// ---------------------------------------------------------------------------

/// Resolve the JSONL file path for a session.
fn resolve_session_path(project_id: &str, session_id: &str) -> Result<PathBuf, String> {
    let claude_dir = crate::watcher::resolve_claude_dir()
        .ok_or("Cannot resolve home directory")?;

    // Handle composite project IDs: "encodedPath::hash" → use "encodedPath"
    let base_dir = if let Some(idx) = project_id.find("::") {
        &project_id[..idx]
    } else {
        project_id
    };

    let path = claude_dir
        .join("projects")
        .join(base_dir)
        .join(format!("{session_id}.jsonl"));

    Ok(path)
}

/// Parse a full session file, returning all messages and metadata.
#[tauri::command]
pub fn parse_session(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<ParsedSession, String> {
    let cache_key = format!("{project_id}/{session_id}");

    // Check cache
    {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let file_path = resolve_session_path(&project_id, &session_id)?;
    let session = session_parser::parse_session_file(&file_path)?;

    // Cache the result
    {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        cache.insert(cache_key, session.clone());
    }

    Ok(session)
}

/// Parse only session metrics (fast path — uses cache if available).
#[tauri::command]
pub fn parse_session_metrics(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<SessionMetrics, String> {
    let cache_key = format!("{project_id}/{session_id}");

    // Check cache for full session (metrics are a subset)
    {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.metrics.clone());
        }
    }

    // Parse just for metrics (still caches the full session)
    let file_path = resolve_session_path(&project_id, &session_id)?;
    let session = session_parser::parse_session_file(&file_path)?;
    let metrics = session.metrics.clone();

    // Cache the full session
    {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        cache.insert(cache_key, session);
    }

    Ok(metrics)
}

// ---------------------------------------------------------------------------
// Project Discovery
// ---------------------------------------------------------------------------

/// Scan ~/.claude/projects/ and return all projects.
#[tauri::command]
pub fn get_projects(
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<Vec<Project>, String> {
    let claude_dir = watcher::resolve_claude_dir()
        .ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);

    let mut registry = registry.lock().map_err(|e| e.to_string())?;
    project_scanner::scan_projects(&projects_dir, &mut registry)
}

/// List sessions for a project with cursor-based pagination.
#[tauri::command]
pub fn get_sessions_paginated(
    project_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
    options: Option<SessionsPaginationOptions>,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<PaginatedSessionsResult, String> {
    let claude_dir = watcher::resolve_claude_dir()
        .ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let opts = options.unwrap_or_default();
    let page_limit = limit.unwrap_or(20).min(100);

    let registry = registry.lock().map_err(|e| e.to_string())?;
    session_lister::list_sessions_paginated(
        &projects_dir,
        &claude_dir,
        &project_id,
        cursor.as_deref(),
        page_limit,
        &opts,
        &registry,
    )
}
