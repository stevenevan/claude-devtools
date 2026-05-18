use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::analysis::chunk_builder;
use crate::cache::SessionCache;
use crate::discovery::{
    ongoing_detector, path_decoder, project_scanner, session_lister,
    subproject_registry::SubprojectRegistry,
};
use crate::parsing::session_parser;
use crate::types::chunks::SessionDetail;
use crate::types::domain::{Session, SessionsPaginationOptions};
use crate::watcher;

use super::claude_root::ClaudeRoot;
use super::get_session_detail;
use super::path_util::{resolve_session_path, resolve_subagent_path, validate_session_id_pair};

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

// ---------------------------------------------------------------------------
// Global ~/.claude/ config readers
// ---------------------------------------------------------------------------

/// Parse YAML-like frontmatter from markdown content.
fn parse_frontmatter(content: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return map;
    }
    if let Some(end) = trimmed[3..].find("\n---") {
        let block = &trimmed[3..3 + end];
        for line in block.lines() {
            let line = line.trim();
            if let Some(colon_pos) = line.find(':') {
                let key = line[..colon_pos].trim().to_string();
                let val = line[colon_pos + 1..].trim().to_string();
                if !key.is_empty() {
                    map.insert(key, val);
                }
            }
        }
    }
    map
}

#[tauri::command]
pub fn read_global_agents() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let agents_dir = claude_dir.join("agents");

    let mut agents = Vec::new();

    if agents_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&agents_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let fm = parse_frontmatter(&content);
                        let name = fm
                            .get("name")
                            .cloned()
                            .unwrap_or_else(|| {
                                path.file_stem()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .to_string()
                            });
                        agents.push(serde_json::json!({
                            "name": name,
                            "description": fm.get("description").cloned().unwrap_or_default(),
                            "tools": fm.get("tools").cloned().unwrap_or_default(),
                            "model": fm.get("model").cloned().unwrap_or_default(),
                            "filePath": path.to_string_lossy(),
                            "content": content,
                        }));
                    }
                }
            }
        }
    }

    agents.sort_by(|a, b| {
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(Value::Array(agents))
}

#[tauri::command]
pub fn read_global_skills() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let skills_dir = claude_dir.join("skills");

    let mut skills = Vec::new();

    if skills_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let symlink_path = entry.path();

                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.starts_with('.') {
                    continue;
                }

                let resolved_path = match std::fs::canonicalize(&symlink_path) {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                if !resolved_path.is_dir() {
                    continue;
                }

                let skill_md = resolved_path.join("SKILL.md");
                let (description, user_invocable) = if skill_md.is_file() {
                    if let Ok(content) = std::fs::read_to_string(&skill_md) {
                        let fm = parse_frontmatter(&content);
                        let desc = fm.get("description").cloned().unwrap_or_default();
                        let invocable = fm.get("user-invocable")
                            .map(|v| v == "true")
                            .unwrap_or(false);
                        (desc, invocable)
                    } else {
                        (String::new(), false)
                    }
                } else {
                    (String::new(), false)
                };

                skills.push(serde_json::json!({
                    "name": file_name,
                    "description": description,
                    "userInvocable": user_invocable,
                    "resolvedPath": resolved_path.to_string_lossy(),
                    "symlinkPath": symlink_path.to_string_lossy(),
                }));
            }
        }
    }

    skills.sort_by(|a, b| {
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(Value::Array(skills))
}

#[tauri::command]
pub fn read_global_plugins() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;

    let plugins_file = claude_dir.join("plugins").join("installed_plugins.json");
    let plugins_data: Value = if plugins_file.is_file() {
        let content = std::fs::read_to_string(&plugins_file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Ok(Value::Array(Vec::new()));
    };

    let settings_file = claude_dir.join("settings.json");
    let enabled_plugins: std::collections::HashSet<String> = if settings_file.is_file() {
        if let Ok(content) = std::fs::read_to_string(&settings_file) {
            if let Ok(settings) = serde_json::from_str::<Value>(&content) {
                if let Some(plugins) = settings.get("enabledPlugins").and_then(|v| v.as_object()) {
                    plugins.iter()
                        .filter(|(_, v)| v.as_bool().unwrap_or(false))
                        .map(|(k, _)| k.clone())
                        .collect()
                } else {
                    std::collections::HashSet::new()
                }
            } else {
                std::collections::HashSet::new()
            }
        } else {
            std::collections::HashSet::new()
        }
    } else {
        std::collections::HashSet::new()
    };

    let mut result = Vec::new();

    if let Some(plugins_map) = plugins_data.get("plugins").and_then(|v| v.as_object()) {
        for (key, entries) in plugins_map {
            let (name, marketplace) = if let Some(at_pos) = key.find('@') {
                (key[..at_pos].to_string(), key[at_pos + 1..].to_string())
            } else {
                (key.clone(), String::new())
            };

            if let Some(entry) = entries.as_array().and_then(|arr| arr.first()) {
                let enabled = enabled_plugins.contains(key)
                    || enabled_plugins.contains(&name);

                result.push(serde_json::json!({
                    "id": key,
                    "name": name,
                    "marketplace": marketplace,
                    "version": entry.get("version").and_then(|v| v.as_str()).unwrap_or(""),
                    "installedAt": entry.get("installedAt").and_then(|v| v.as_str()).unwrap_or(""),
                    "lastUpdated": entry.get("lastUpdated").and_then(|v| v.as_str()).unwrap_or(""),
                    "enabled": enabled,
                }));
            }
        }
    }

    result.sort_by(|a, b| {
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(Value::Array(result))
}

#[tauri::command]
pub fn read_global_settings() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let settings_file = claude_dir.join("settings.json");

    if settings_file.is_file() {
        let content = std::fs::read_to_string(&settings_file).map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(value)
    } else {
        Ok(serde_json::json!({}))
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Waterfall / subagent / groups / context stubs
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_waterfall_data(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
    timing: tauri::State<'_, Arc<crate::timing::TimingBuffer>>,
    claude_root: tauri::State<'_, ClaudeRoot>,
) -> Result<Option<SessionDetail>, String> {
    get_session_detail(project_id, session_id, cache, timing, claude_root).map(Some)
}

#[tauri::command]
pub fn get_subagent_detail(
    project_id: String,
    session_id: String,
    subagent_id: String,
    _cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
    claude_root: tauri::State<'_, ClaudeRoot>,
) -> Result<Option<SessionDetail>, String> {
    let subagent_path = resolve_subagent_path(
        claude_root.canonical_projects(),
        &project_id,
        &session_id,
        &subagent_id,
    )?;
    let base_dir = path_decoder::extract_base_dir(&project_id);

    if !subagent_path.exists() {
        return Ok(None);
    }

    let parsed = session_parser::parse_session_file(&subagent_path)?;
    let decoded_path = path_decoder::decode_path(&base_dir);

    let is_ongoing = ongoing_detector::detect_ongoing(&subagent_path);

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
        is_ongoing,
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
        custom_title: None,
        agent_name: None,
    };

    Ok(Some(chunk_builder::build_session_detail(
        session,
        parsed.messages,
        vec![],
    )))
}

#[tauri::command]
pub fn get_session_groups(
    _project_id: String,
    _session_id: String,
    _cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<Value, String> {
    Ok(serde_json::json!([]))
}

#[tauri::command]
pub fn get_repository_groups(
    _registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<Value, String> {
    Ok(serde_json::json!([]))
}

#[tauri::command]
pub fn get_worktree_sessions(
    _worktree_id: String,
) -> Result<Vec<Session>, String> {
    Ok(vec![])
}

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
