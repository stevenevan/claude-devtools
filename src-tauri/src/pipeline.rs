//! App-path session-detail orchestration — the in-app `getSessionDetail`.
//!
//! Mirrors `internal/sessionservice.buildSessionDetail`, NOT the CLI
//! `show-session` path: it resolves subagents into `processes` and reports
//! `has_subagents` / `is_ongoing`, matching the frozen `DesktopAPI` contract
//! (invariant #2). The CLI twin's empty-processes build stays in `bin/cli.rs`.

use crate::analysis::chunk_builder::build_session_detail;
use crate::analytics::scan_session_light;
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

    let light_summary = scan_session_light(&file_path);
    let metadata = file_path
        .metadata()
        .map_err(|error| format!("failed to read session metadata: {error}"))?;
    let modified = metadata
        .modified()
        .map_err(|error| format!("failed to read session modified time: {error}"))?;
    let modified_since_epoch = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("session modified time predates Unix epoch: {error}"))?;
    let created_at = modified_since_epoch.as_secs_f64() * 1000.0;
    let parsed = session_parser::parse_session_file(&file_path)?;
    let subagents = subagent_resolver::resolve_subagents(
        &pd,
        project_id,
        session_id,
        &parsed.task_calls,
        &parsed.messages,
    );
    let is_ongoing = ongoing_detector::detect_ongoing(&file_path);

    let session = Session {
        id: session_id.to_string(),
        project_id: project_id.to_string(),
        project_path: path_decoder::decode_path(path_decoder::extract_base_dir(project_id)),
        todo_data: None,
        created_at,
        first_message: light_summary
            .as_ref()
            .and_then(|summary| summary.first_user_text.clone()),
        message_timestamp: light_summary
            .as_ref()
            .and_then(|summary| summary.first_timestamp.clone()),
        has_subagents: !subagents.is_empty(),
        message_count: light_summary
            .as_ref()
            .map(|summary| summary.message_count)
            .unwrap_or(parsed.messages.len() as u32),
        cost_usd: light_summary.as_ref().and_then(|summary| summary.cost_usd),
        is_ongoing,
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
        custom_title: light_summary
            .as_ref()
            .and_then(|summary| summary.custom_title.clone())
            .or(parsed.custom_title.clone()),
        agent_name: light_summary
            .as_ref()
            .and_then(|summary| summary.agent_name.clone())
            .or(parsed.agent_name.clone()),
    };

    Ok(build_session_detail(session, parsed.messages, subagents))
}
