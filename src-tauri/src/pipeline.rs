//! App-path session-detail orchestration — the in-app `getSessionDetail`.
//!
//! Mirrors `internal/sessionservice.buildSessionDetail`, NOT the CLI
//! `show-session` path: it resolves subagents into `processes` and reports
//! `has_subagents` / `is_ongoing`, matching the frozen `WailsAPI` contract
//! (invariant #2). The CLI twin's empty-processes build stays in `bin/cli.rs`.

use crate::analysis::chunk_builder::build_session_detail;
use crate::config::root::projects_dir;
use crate::discovery::{ongoing_detector, path_decoder, subagent_resolver};
use crate::parsing::session_parser;
use crate::types::chunks::SessionDetail;
use crate::types::domain::Session;

pub fn get_session_detail(project_id: &str, session_id: &str) -> Result<SessionDetail, String> {
    if !path_decoder::is_valid_project_id(project_id) {
        return Err(format!("invalid project ID: {project_id:?}"));
    }
    if !path_decoder::is_valid_session_id(session_id) {
        return Err(format!("invalid session ID: {session_id:?}"));
    }

    let pd = projects_dir()?;
    let base = path_decoder::extract_base_dir(project_id);
    let file_path = pd.join(base).join(format!("{session_id}.jsonl"));

    let parsed = session_parser::parse_session_file(&file_path)?;
    let subagents =
        subagent_resolver::resolve_subagents(&pd, project_id, session_id, &parsed.task_calls, &parsed.messages);
    let is_ongoing = ongoing_detector::detect_ongoing(&file_path);

    let session = Session {
        id: session_id.to_string(),
        project_id: project_id.to_string(),
        project_path: path_decoder::decode_path(path_decoder::extract_base_dir(project_id)),
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

    Ok(build_session_detail(session, parsed.messages, subagents))
}
