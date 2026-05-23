use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::analysis::chunk_builder;
use crate::cache::SessionCache;
use crate::commands::claude_root::ClaudeRoot;
use crate::commands::get_session_detail;
use crate::commands::path_util::resolve_subagent_path;
use crate::discovery::{
    ongoing_detector, path_decoder, subproject_registry::SubprojectRegistry,
};
use crate::parsing::session_parser;
use crate::types::chunks::SessionDetail;
use crate::types::domain::Session;

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
