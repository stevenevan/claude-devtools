use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::analysis::chunk_builder;
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

// ---------------------------------------------------------------------------
// Global ~/.claude/ config readers
// ---------------------------------------------------------------------------

/// Parse YAML-like frontmatter from markdown content.
/// Returns key-value pairs from the block between the first two `---` markers.
fn parse_frontmatter(content: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return map;
    }
    // Find the closing `---` after the opening one
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

/// Read global agent configs from ~/.claude/agents/*.md.
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

    // Sort by name for stable ordering
    agents.sort_by(|a, b| {
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(Value::Array(agents))
}

/// Read global skills from ~/.claude/skills/ (symlinks to skill directories).
#[tauri::command]
pub fn read_global_skills() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let skills_dir = claude_dir.join("skills");

    let mut skills = Vec::new();

    if skills_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let symlink_path = entry.path();

                // Skip non-symlinks and hidden files
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.starts_with('.') {
                    continue;
                }

                // Resolve symlink target
                let resolved_path = match std::fs::canonicalize(&symlink_path) {
                    Ok(p) => p,
                    Err(_) => continue, // Broken symlink, skip
                };

                if !resolved_path.is_dir() {
                    continue;
                }

                // Look for SKILL.md
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

/// Read installed plugins from ~/.claude/plugins/installed_plugins.json
/// and cross-reference enabled state from ~/.claude/settings.json.
#[tauri::command]
pub fn read_global_plugins() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;

    // Read installed plugins
    let plugins_file = claude_dir.join("plugins").join("installed_plugins.json");
    let plugins_data: Value = if plugins_file.is_file() {
        let content = std::fs::read_to_string(&plugins_file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Ok(Value::Array(Vec::new()));
    };

    // Read settings for enabledPlugins
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
            // Key format: "name@marketplace"
            let (name, marketplace) = if let Some(at_pos) = key.find('@') {
                (key[..at_pos].to_string(), key[at_pos + 1..].to_string())
            } else {
                (key.clone(), String::new())
            };

            // Take the first (most recent) entry
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

/// Read global settings from ~/.claude/settings.json.
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

/// Search sessions within a project.
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
    _cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
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

/// Get conversation groups (returns session detail chunks).
#[tauri::command]
pub fn get_session_groups(
    _project_id: String,
    _session_id: String,
    _cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<Value, String> {
    // Session groups are built from the session detail on the frontend.
    // Return empty array — the frontend's ConversationGroupBuilder handles this client-side.
    Ok(serde_json::json!([]))
}

/// Get repository groups.
#[tauri::command]
pub fn get_repository_groups(
    _registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<Value, String> {
    // Repository grouping requires git identity resolution.
    // Return empty for now — this is a secondary UI feature.
    Ok(serde_json::json!([]))
}

/// Get worktree sessions.
#[tauri::command]
pub fn get_worktree_sessions(
    _worktree_id: String,
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
