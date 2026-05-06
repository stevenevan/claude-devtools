use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::analysis::chunk_builder;
use crate::analysis::tokenizer;
use crate::analysis::tool_linking;
use crate::cache::SessionCache;
use crate::discovery::{
    ongoing_detector, path_decoder, project_scanner, session_lister, subagent_resolver,
    subproject_registry::SubprojectRegistry,
};
use crate::parsing::session_parser;
use crate::types::chunks::SessionDetail;
use crate::types::domain::{
    PaginatedSessionsResult, ParsedSession, Project, Session, SessionMetrics,
    SessionsPaginationOptions,
};
use crate::watcher;

mod agents_search;
pub use agents_search::*;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/// Returns the app version from Cargo.toml.
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---------------------------------------------------------------------------
// Cross-project todos dashboard
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregatedSessionTodos {
    pub project_id: String,
    pub session_id: String,
    pub updated_at: f64,
    pub items: serde_json::Value,
}

/// Load todo data for every session across the requested projects.
#[tauri::command]
pub fn get_all_todos(project_ids: Vec<String>) -> Result<Vec<AggregatedSessionTodos>, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let todos_dir = claude_dir.join("todos");
    let mut out: Vec<AggregatedSessionTodos> = Vec::new();

    for project_id in &project_ids {
        let base_id = match project_id.find("::") {
            Some(idx) => &project_id[..idx],
            None => project_id.as_str(),
        };
        let project_dir = projects_dir.join(base_id);
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
            let todo_path = todos_dir.join(format!("{session_id}.json"));
            if !todo_path.exists() {
                continue;
            }
            let content = match std::fs::read_to_string(&todo_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let items: serde_json::Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let updated_at = std::fs::metadata(&todo_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            out.push(AggregatedSessionTodos {
                project_id: project_id.clone(),
                session_id,
                updated_at,
                items,
            });
        }
    }

    out.sort_by(|a, b| b.updated_at.partial_cmp(&a.updated_at).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
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
// Analytics
// ---------------------------------------------------------------------------

/// Compute pre-aggregated analytics data across all projects.
#[tauri::command]
pub fn get_analytics(
    days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::AnalyticsResponse, String> {
    crate::analytics::compute_analytics(days, &registry)
}

/// Linear-regression cost forecast over trailing `window_days` of daily totals.
#[tauri::command]
pub fn get_cost_forecast(
    window_days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::CostForecast, String> {
    crate::analytics::compute_cost_forecast(window_days, &registry)
}

/// Per-day productivity metrics: sessions, active minutes, tool calls, token p50/p95.
#[tauri::command]
pub fn get_productivity_metrics(
    days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::ProductivityMetrics, String> {
    crate::analytics::compute_productivity_metrics(days, &registry)
}

/// Per-session wall/active durations with p50/p95/max stats and outlier ids.
#[tauri::command]
pub fn get_session_duration_stats(
    days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::SessionDurationResponse, String> {
    crate::analytics::compute_session_duration_stats(days, &registry)
}

/// Per-model metrics — cost/token, tokens/session, tool-calls/session, error rate, latency.
#[tauri::command]
pub fn get_model_comparison(
    days: u32,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<crate::analytics::ModelComparisonResponse, String> {
    crate::analytics::compute_model_comparison(days, &registry)
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
    timing: tauri::State<'_, Arc<crate::timing::TimingBuffer>>,
) -> Result<SessionDetail, String> {
    let _guard = crate::timing::TimingGuard::new(&timing, "get_session_detail");
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

    // Detect if session is currently active
    let session_file_path = resolve_session_path(&project_id, &session_id)?;
    let is_ongoing = ongoing_detector::detect_ongoing(&session_file_path);

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
        is_ongoing,
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
        custom_title: parsed.custom_title.clone(),
        agent_name: parsed.agent_name.clone(),
    };

    Ok(chunk_builder::build_session_detail(
        session,
        parsed.messages,
        subagents,
    ))
}

/// Incrementally refresh a session — only re-parses new JSONL lines since last read.
/// Returns a full SessionDetail (same as get_session_detail) but much faster for
/// ongoing sessions where only a few new lines were appended.
/// Falls back to full parse on first call or when incremental state is missing.
#[tauri::command]
pub fn get_session_detail_incremental(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<SessionDetail, String> {
    let claude_dir = watcher::resolve_claude_dir()
        .ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let file_path = resolve_session_path(&project_id, &session_id)?;
    let cache_key = format!("{project_id}/{session_id}");

    // Try incremental parse if we have prior state
    let parsed = {
        let mut cache_guard = cache.lock().map_err(|e| e.to_string())?;

        let inc_state = cache_guard.get_incremental(&cache_key).cloned();
        let cached_session = cache_guard.get(&cache_key).cloned();

        match (inc_state, cached_session) {
            (Some(state), Some(mut existing)) => {
                // Incremental path: only read new bytes
                let (new_msgs, new_metadata, new_offset) =
                    session_parser::parse_jsonl_incremental(
                        &file_path,
                        state.byte_offset,
                        &state.metadata,
                    )?;

                if new_msgs.is_empty() {
                    // No new data — return cached session as-is
                    existing
                } else {
                    // Merge new messages into existing session
                    existing.messages.extend(new_msgs);
                    if new_metadata.custom_title.is_some() {
                        existing.custom_title = new_metadata.custom_title.clone();
                    }
                    if new_metadata.agent_name.is_some() {
                        existing.agent_name = new_metadata.agent_name.clone();
                    }

                    // Recompute categorization and metrics
                    let reprocessed = session_parser::process_messages(
                        existing.messages,
                        session_parser::SessionFileMetadata {
                            custom_title: existing.custom_title,
                            agent_name: existing.agent_name,
                        },
                    );

                    // Update cache
                    cache_guard.set_incremental(
                        cache_key.clone(),
                        crate::cache::IncrementalState {
                            byte_offset: new_offset,
                            metadata: new_metadata,
                        },
                    );
                    cache_guard.insert(cache_key, reprocessed.clone());
                    reprocessed
                }
            }
            _ => {
                // First call or missing state — full parse, then seed incremental state
                let session = session_parser::parse_session_file(&file_path)?;

                // Compute the byte offset by reading file size
                let file_len = std::fs::metadata(&file_path)
                    .map(|m| m.len())
                    .unwrap_or(0);

                cache_guard.set_incremental(
                    cache_key.clone(),
                    crate::cache::IncrementalState {
                        byte_offset: file_len,
                        metadata: session_parser::SessionFileMetadata {
                            custom_title: session.custom_title.clone(),
                            agent_name: session.agent_name.clone(),
                        },
                    },
                );
                cache_guard.insert(cache_key, session.clone());
                session
            }
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

    let decoded_path = path_decoder::decode_path(
        &path_decoder::extract_base_dir(&project_id),
    );

    let is_ongoing = ongoing_detector::detect_ongoing(&file_path);

    let session = Session {
        id: session_id.clone(),
        project_id: project_id.clone(),
        project_path: decoded_path,
        todo_data: None,
        created_at: 0.0,
        first_message: None,
        message_timestamp: None,
        has_subagents: !subagents.is_empty(),
        message_count: parsed.messages.len() as u32,
        is_ongoing,
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
        custom_title: parsed.custom_title.clone(),
        agent_name: parsed.agent_name.clone(),
    };

    Ok(chunk_builder::build_session_detail(
        session,
        parsed.messages,
        subagents,
    ))
}

// ---------------------------------------------------------------------------
// Tool Linking (Sprint 28)
// ---------------------------------------------------------------------------

/// Link tool calls to their results in Rust.
#[tauri::command]
pub fn link_tool_calls(
    steps: Vec<crate::types::chunks::SemanticStep>,
    responses: Option<Vec<tool_linking::ParsedMessageInput>>,
) -> Result<std::collections::HashMap<String, tool_linking::LinkedToolItem>, String> {
    let responses_ref = responses.as_deref();
    Ok(tool_linking::link_tool_calls_to_results(&steps, responses_ref))
}

// ---------------------------------------------------------------------------
// Tokenizer (Sprint 29)
// ---------------------------------------------------------------------------

/// Count tokens in a string using tiktoken cl100k_base.
#[tauri::command]
pub fn count_tokens(text: String) -> Result<usize, String> {
    Ok(tokenizer::count_tokens(&text))
}

/// Count tokens for multiple strings in a batch.
#[tauri::command]
pub fn count_tokens_batch(texts: Vec<String>) -> Result<Vec<usize>, String> {
    Ok(tokenizer::count_tokens_batch(&texts))
}
