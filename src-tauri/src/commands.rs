use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::analysis::chunk_builder;
use crate::cache::SessionCache;
use crate::discovery::{
    path_decoder, project_scanner, session_lister, subagent_resolver,
    subproject_registry::SubprojectRegistry,
};
use crate::parsing::session_parser;
use crate::types::chunks::SessionDetail;
use crate::types::domain::{
    PaginatedSessionsResult, ParsedSession, Project, Session, SessionMetrics,
    SessionsPaginationOptions,
};
use crate::watcher;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/// Returns the app version from Cargo.toml.
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---------------------------------------------------------------------------
// Additional Session / Data Commands (Sprint 8)
// ---------------------------------------------------------------------------

/// List all sessions for a project (non-paginated, used by some UI paths).
#[tauri::command]
pub fn get_sessions(
    project_id: String,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<Vec<Session>, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let opts = SessionsPaginationOptions::default();
    let registry = registry.lock().map_err(|e| e.to_string())?;

    // Use paginated lister with a large limit to get all sessions
    let result = session_lister::list_sessions_paginated(
        &projects_dir, &claude_dir, &project_id, None, 10000, &opts, &registry,
    )?;
    Ok(result.sessions)
}

/// Get sessions by specific IDs.
#[tauri::command]
pub fn get_sessions_by_ids(
    project_id: String,
    session_ids: Vec<String>,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<Vec<Session>, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let opts = SessionsPaginationOptions::default();
    let registry = registry.lock().map_err(|e| e.to_string())?;

    let all = session_lister::list_sessions_paginated(
        &projects_dir, &claude_dir, &project_id, None, 10000, &opts, &registry,
    )?;

    Ok(all
        .sessions
        .into_iter()
        .filter(|s| session_ids.contains(&s.id))
        .collect())
}

/// Validate a path relative to a project root.
#[tauri::command]
pub fn validate_path(
    relative_path: String,
    project_path: String,
) -> Result<Value, String> {
    let base = std::path::Path::new(&project_path);
    let joined = base.join(&relative_path);

    // Prevent path traversal
    let canonical = joined.canonicalize().ok();
    let base_canonical = base.canonicalize().ok();

    if let (Some(ref c), Some(ref bc)) = (&canonical, &base_canonical) {
        if !c.starts_with(bc) {
            return Ok(serde_json::json!({ "exists": false }));
        }
    }

    let exists = joined.exists();
    let is_directory = joined.is_dir();

    Ok(serde_json::json!({
        "exists": exists,
        "isDirectory": is_directory,
    }))
}

/// Batch validate mentions.
#[tauri::command]
pub fn validate_mentions(
    mentions: Vec<Value>,
    project_path: String,
) -> Result<Value, String> {
    let base = std::path::Path::new(&project_path);
    let mut result = serde_json::Map::new();

    for mention in &mentions {
        if let Some(value) = mention.get("value").and_then(|v| v.as_str()) {
            let joined = base.join(value);
            result.insert(value.to_string(), Value::Bool(joined.exists()));
        }
    }

    Ok(Value::Object(result))
}

/// Read CLAUDE.md files from global, project, and directory locations.
#[tauri::command]
pub fn read_claude_md_files(
    project_root: String,
) -> Result<Value, String> {
    let mut files = serde_json::Map::new();
    let root = std::path::Path::new(&project_root);

    // Global CLAUDE.md
    if let Some(home) = dirs::home_dir() {
        let global = home.join(".claude").join("CLAUDE.md");
        if let Ok(content) = std::fs::read_to_string(&global) {
            files.insert("global".to_string(), serde_json::json!({
                "path": global.to_string_lossy(),
                "content": content,
                "exists": true,
            }));
        }
    }

    // Project CLAUDE.md
    let project_md = root.join("CLAUDE.md");
    if let Ok(content) = std::fs::read_to_string(&project_md) {
        files.insert("project".to_string(), serde_json::json!({
            "path": project_md.to_string_lossy(),
            "content": content,
            "exists": true,
        }));
    }

    // .claude/rules/ directory
    let rules_dir = root.join(".claude").join("rules");
    if rules_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&rules_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let key = format!("rules/{}", path.file_name().unwrap_or_default().to_string_lossy());
                        files.insert(key, serde_json::json!({
                            "path": path.to_string_lossy(),
                            "content": content,
                            "exists": true,
                        }));
                    }
                }
            }
        }
    }

    Ok(Value::Object(files))
}

/// Read a specific directory's CLAUDE.md.
#[tauri::command]
pub fn read_directory_claude_md(
    dir_path: String,
) -> Result<Value, String> {
    let md_path = std::path::Path::new(&dir_path).join("CLAUDE.md");
    if let Ok(content) = std::fs::read_to_string(&md_path) {
        Ok(serde_json::json!({
            "path": md_path.to_string_lossy(),
            "content": content,
            "exists": true,
        }))
    } else {
        Ok(serde_json::json!({
            "path": md_path.to_string_lossy(),
            "content": "",
            "exists": false,
        }))
    }
}

/// Read a mentioned file with path validation and token estimation.
#[tauri::command]
pub fn read_mentioned_file(
    absolute_path: String,
    project_root: String,
    max_tokens: Option<usize>,
) -> Result<Option<Value>, String> {
    let path = std::path::Path::new(&absolute_path);

    // Validate path is under project root
    let root = std::path::Path::new(&project_root);
    if let (Ok(cp), Ok(cr)) = (path.canonicalize(), root.canonicalize()) {
        if !cp.starts_with(&cr) {
            return Ok(None);
        }
    }

    if !path.exists() || !path.is_file() {
        return Ok(None);
    }

    match std::fs::read_to_string(path) {
        Ok(content) => {
            let tokens = (content.len() + 3) / 4; // estimate ~4 chars per token
            let max = max_tokens.unwrap_or(100_000);
            let truncated = tokens > max;
            let final_content = if truncated {
                content[..max * 4].to_string()
            } else {
                content
            };

            Ok(Some(serde_json::json!({
                "path": absolute_path,
                "content": final_content,
                "exists": true,
                "tokens": tokens,
                "truncated": truncated,
            })))
        }
        Err(_) => Ok(None),
    }
}

/// Read agent config files from .claude/agents/*.md.
#[tauri::command]
pub fn read_agent_configs(
    project_root: String,
) -> Result<Value, String> {
    let agents_dir = std::path::Path::new(&project_root)
        .join(".claude")
        .join("agents");

    let mut configs = serde_json::Map::new();

    if agents_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&agents_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let name = path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        configs.insert(name, serde_json::json!({
                            "content": content,
                            "path": path.to_string_lossy(),
                        }));
                    }
                }
            }
        }
    }

    Ok(Value::Object(configs))
}

/// Search sessions within a project.
#[tauri::command]
pub fn search_sessions(
    project_id: String,
    query: String,
    max_results: Option<usize>,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
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

        // Check first_message preview
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

/// Search across all projects.
#[tauri::command]
pub fn search_all_projects(
    query: String,
    max_results: Option<usize>,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
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

/// Get waterfall data for a session (reuses session detail).
#[tauri::command]
pub fn get_waterfall_data(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<Option<SessionDetail>, String> {
    // Reuse get_session_detail which already builds chunks
    get_session_detail(project_id, session_id, cache).map(Some)
}

/// Get subagent detail view.
#[tauri::command]
pub fn get_subagent_detail(
    project_id: String,
    session_id: String,
    subagent_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<Option<SessionDetail>, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);

    // Try to find and parse the subagent file
    let base_dir = path_decoder::extract_base_dir(&project_id);
    let subagent_path = projects_dir
        .join(&base_dir)
        .join(&session_id)
        .join("subagents")
        .join(format!("{subagent_id}.jsonl"));

    if !subagent_path.exists() {
        return Ok(None);
    }

    let parsed = session_parser::parse_session_file(&subagent_path)?;
    let decoded_path = path_decoder::decode_path(&base_dir);

    let session = Session {
        id: subagent_id.clone(),
        project_id: project_id.clone(),
        project_path: decoded_path,
        todo_data: None,
        created_at: 0.0,
        first_message: None,
        message_timestamp: None,
        has_subagents: false,
        message_count: parsed.messages.len() as u32,
        is_ongoing: None,
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
    };

    Ok(Some(chunk_builder::build_session_detail(
        session,
        parsed.messages,
        vec![],
    )))
}

/// Get conversation groups (returns session detail chunks).
#[tauri::command]
pub fn get_session_groups(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<Value, String> {
    // Session groups are built from the session detail on the frontend.
    // Return empty array — the frontend's ConversationGroupBuilder handles this client-side.
    Ok(serde_json::json!([]))
}

/// Get repository groups.
#[tauri::command]
pub fn get_repository_groups(
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<Value, String> {
    // Repository grouping requires git identity resolution.
    // Return empty for now — this is a secondary UI feature.
    Ok(serde_json::json!([]))
}

/// Get worktree sessions.
#[tauri::command]
pub fn get_worktree_sessions(
    worktree_id: String,
) -> Result<Vec<Session>, String> {
    // Worktree sessions require git identity resolution.
    // Return empty for now — this is a secondary UI feature.
    Ok(vec![])
}

/// Context stubs — always local mode.
#[tauri::command]
pub fn context_list() -> Result<Value, String> {
    Ok(serde_json::json!([{ "id": "local", "type": "local" }]))
}

#[tauri::command]
pub fn context_get_active() -> Result<String, String> {
    Ok("local".to_string())
}

#[tauri::command]
pub fn context_switch(context_id: String) -> Result<Value, String> {
    Ok(serde_json::json!({ "contextId": context_id }))
}

/// Scroll to line — this is a UI-only operation, just validate and return.
#[tauri::command]
pub fn session_scroll_to_line(
    session_id: String,
    line_number: u32,
) -> Result<Value, String> {
    Ok(serde_json::json!({
        "success": true,
        "sessionId": session_id,
        "lineNumber": line_number,
    }))
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

// ---------------------------------------------------------------------------
// Session Detail (chunks + processes)
// ---------------------------------------------------------------------------

/// Parse a session and build chunks with subagent resolution.
#[tauri::command]
pub fn get_session_detail(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<SessionDetail, String> {
    let claude_dir = watcher::resolve_claude_dir()
        .ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);

    // Parse session (with cache)
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

    // Resolve subagents
    let subagents = subagent_resolver::resolve_subagents(
        &projects_dir,
        &project_id,
        &session_id,
        &parsed.task_calls,
        &parsed.messages,
    );

    // Build a minimal Session struct
    let decoded_path = path_decoder::decode_path(
        &path_decoder::extract_base_dir(&project_id),
    );
    let session = Session {
        id: session_id.clone(),
        project_id: project_id.clone(),
        project_path: decoded_path.clone(),
        todo_data: None,
        created_at: 0.0, // Not critical for detail view
        first_message: None,
        message_timestamp: None,
        has_subagents: !subagents.is_empty(),
        message_count: parsed.messages.len() as u32,
        is_ongoing: None,
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
    };

    Ok(chunk_builder::build_session_detail(
        session,
        parsed.messages,
        subagents,
    ))
}
