use std::sync::{Arc, Mutex};

use crate::analysis::chunk_builder;
use crate::cache::SessionCache;
use crate::commands::path_util::resolve_session_path;
use crate::discovery::{
    ongoing_detector, path_decoder, session_lister, subagent_resolver,
    subproject_registry::SubprojectRegistry,
};
use crate::parsing::session_parser;
use crate::types::chunks::SessionDetail;
use crate::types::domain::{
    PaginatedSessionsResult, Session, SessionsPaginationOptions,
};
use crate::watcher;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregatedSessionTodos {
    pub project_id: String,
    pub session_id: String,
    pub updated_at: f64,
    pub items: serde_json::Value,
}

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

#[tauri::command]
pub fn get_sessions(
    project_id: String,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<Vec<Session>, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let opts = SessionsPaginationOptions::default();
    let registry = registry.lock().map_err(|e| e.to_string())?;

    let result = session_lister::list_sessions_paginated(
        &projects_dir, &claude_dir, &project_id, None, 10000, &opts, &registry,
    )?;
    Ok(result.sessions)
}

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

#[tauri::command]
pub fn get_sessions_paginated(
    project_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
    options: Option<SessionsPaginationOptions>,
    registry: tauri::State<'_, Arc<Mutex<SubprojectRegistry>>>,
) -> Result<PaginatedSessionsResult, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
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

#[tauri::command]
pub fn get_session_detail(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
    timing: tauri::State<'_, Arc<crate::timing::TimingBuffer>>,
) -> Result<SessionDetail, String> {
    let _guard = crate::timing::TimingGuard::new(&timing, "get_session_detail");
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);

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

    let session_file_path = resolve_session_path(&project_id, &session_id)?;
    let is_ongoing = ongoing_detector::detect_ongoing(&session_file_path);

    let session = Session {
        id: session_id.clone(),
        project_id: project_id.clone(),
        project_path: decoded_path.clone(),
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

#[tauri::command]
pub fn get_session_detail_incremental(
    project_id: String,
    session_id: String,
    cache: tauri::State<'_, Arc<Mutex<SessionCache>>>,
) -> Result<SessionDetail, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let file_path = resolve_session_path(&project_id, &session_id)?;
    let cache_key = format!("{project_id}/{session_id}");

    let parsed = {
        let mut cache_guard = cache.lock().map_err(|e| e.to_string())?;

        let inc_state = cache_guard.get_incremental(&cache_key).cloned();
        let cached_session = cache_guard.get(&cache_key).cloned();

        match (inc_state, cached_session) {
            (Some(state), Some(mut existing)) => {
                let (new_msgs, new_metadata, new_offset) =
                    session_parser::parse_jsonl_incremental(
                        &file_path,
                        state.byte_offset,
                        &state.metadata,
                    )?;

                if new_msgs.is_empty() {
                    existing
                } else {
                    existing.messages.extend(new_msgs);
                    if new_metadata.custom_title.is_some() {
                        existing.custom_title = new_metadata.custom_title.clone();
                    }
                    if new_metadata.agent_name.is_some() {
                        existing.agent_name = new_metadata.agent_name.clone();
                    }

                    let reprocessed = session_parser::process_messages(
                        existing.messages,
                        session_parser::SessionFileMetadata {
                            custom_title: existing.custom_title,
                            agent_name: existing.agent_name,
                        },
                    );

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
                let session = session_parser::parse_session_file(&file_path)?;

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
