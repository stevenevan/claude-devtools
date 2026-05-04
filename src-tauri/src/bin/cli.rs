//! claude-devtools-cli (sprint 44, simplified)
//!
//! Minimal CLI companion for inspecting Claude session data without the
//! Tauri shell. Subcommands:
//!
//!   list                List projects
//!   sessions <project>  List sessions for a project (encoded id)
//!   show <project> <session>   Print session detail
//!   stats               Print session counts and total tokens across all projects
//!
//! All commands accept `--json` to emit machine-readable JSON instead
//! of human text.
//!
//! NOTE: this sprint deferred the full Cargo workspace split (architect
//! sign-off pre-condition not met). The CLI ships as a second `[[bin]]`
//! target inside the existing `claude-devtools` crate; the workspace
//! restructure can land in a follow-up without breaking the public CLI
//! surface.

use std::process::ExitCode;

use claude_devtools_lib::analysis::chunk_builder;
use claude_devtools_lib::discovery::path_decoder;
use claude_devtools_lib::discovery::project_scanner;
use claude_devtools_lib::discovery::session_lister;
use claude_devtools_lib::discovery::subproject_registry::SubprojectRegistry;
use claude_devtools_lib::parsing::session_parser;
use claude_devtools_lib::types::domain::{Session, SessionsPaginationOptions};

fn projects_dir() -> std::path::PathBuf {
    let home = dirs::home_dir().expect("home directory");
    home.join(".claude").join("projects")
}

fn print_help() {
    println!(
        "claude-devtools-cli\n\nUSAGE:\n  claude-devtools-cli list [--json]\n  claude-devtools-cli sessions <project_id> [--json]\n  claude-devtools-cli show <project_id> <session_id> [--json]\n  claude-devtools-cli stats [--json]\n"
    );
}

fn cmd_list(json: bool) -> Result<(), String> {
    let mut registry = SubprojectRegistry::new();
    let projects = project_scanner::scan_projects(&projects_dir(), &mut registry)?;
    if json {
        let payload = serde_json::to_string(&projects).map_err(|e| e.to_string())?;
        println!("{payload}");
    } else {
        for p in &projects {
            println!("{}\t{}", p.id, p.name);
        }
        println!("\n{} projects", projects.len());
    }
    Ok(())
}

fn claude_dir() -> std::path::PathBuf {
    dirs::home_dir().expect("home").join(".claude")
}

fn cmd_sessions(project_id: &str, json: bool) -> Result<(), String> {
    let dir = projects_dir();
    let opts = SessionsPaginationOptions::default();
    let registry = SubprojectRegistry::new();
    let result = session_lister::list_sessions_paginated(
        &dir,
        &claude_dir(),
        project_id,
        None,
        100,
        &opts,
        &registry,
    )?;
    if json {
        let payload = serde_json::to_string(&result.sessions).map_err(|e| e.to_string())?;
        println!("{payload}");
    } else {
        for s in &result.sessions {
            println!(
                "{}\t{}\tmessages={}",
                s.id,
                s.first_message.as_deref().unwrap_or("(no preview)"),
                s.message_count
            );
        }
        println!(
            "\n{} sessions (more={})",
            result.sessions.len(),
            result.has_more
        );
    }
    Ok(())
}

fn cmd_show(project_id: &str, session_id: &str, json: bool) -> Result<(), String> {
    let projects_dir = projects_dir();
    let encoded_dir = projects_dir.join(project_id);
    let session_path = encoded_dir.join(format!("{session_id}.jsonl"));
    let parsed = session_parser::parse_session_file(&session_path)?;
    let session = Session {
        id: session_id.to_string(),
        project_id: project_id.to_string(),
        project_path: path_decoder::decode_path(&path_decoder::extract_base_dir(project_id)),
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
        custom_title: parsed.custom_title.clone(),
        agent_name: parsed.agent_name.clone(),
    };
    let detail = chunk_builder::build_session_detail(session, parsed.messages, vec![]);
    if json {
        let payload = serde_json::to_string(&detail).map_err(|e| e.to_string())?;
        println!("{payload}");
    } else {
        println!("Session: {}", session_id);
        println!("Chunks:  {}", detail.chunks.len());
        println!("Messages:{}", detail.messages.len());
        println!(
            "Tokens:  total={} input={} output={} cache_read={}",
            detail.metrics.total_tokens,
            detail.metrics.input_tokens,
            detail.metrics.output_tokens,
            detail.metrics.cache_read_tokens
        );
        if let Some(cost) = detail.metrics.cost_usd {
            println!("Cost:    ${cost:.4}");
        }
    }
    Ok(())
}

fn cmd_stats(json: bool) -> Result<(), String> {
    let mut registry = SubprojectRegistry::new();
    let projects = project_scanner::scan_projects(&projects_dir(), &mut registry)?;
    let mut total_sessions: usize = 0;
    let mut total_messages: u64 = 0;
    for p in &projects {
        let opts = SessionsPaginationOptions::default();
        if let Ok(result) = session_lister::list_sessions_paginated(
            &projects_dir(),
            &claude_dir(),
            &p.id,
            None,
            1000,
            &opts,
            &registry,
        ) {
            total_sessions += result.sessions.len();
            total_messages += result
                .sessions
                .iter()
                .map(|s| s.message_count as u64)
                .sum::<u64>();
        }
    }
    if json {
        println!(
            "{{\"projects\":{},\"sessions\":{},\"messages\":{}}}",
            projects.len(),
            total_sessions,
            total_messages
        );
    } else {
        println!("projects:  {}", projects.len());
        println!("sessions:  {total_sessions}");
        println!("messages:  {total_messages}");
    }
    Ok(())
}

fn parse_flag<'a>(args: &'a [String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = parse_flag(&args, "--json");
    let positional: Vec<String> = args.iter().filter(|a| !a.starts_with("--")).cloned().collect();

    let cmd = positional.first().map(|s| s.as_str()).unwrap_or("");
    let result = match cmd {
        "list" => cmd_list(json),
        "sessions" => match positional.get(1) {
            Some(p) => cmd_sessions(p, json),
            None => Err("sessions requires <project_id>".to_string()),
        },
        "show" => match (positional.get(1), positional.get(2)) {
            (Some(p), Some(s)) => cmd_show(p, s, json),
            _ => Err("show requires <project_id> <session_id>".to_string()),
        },
        "stats" => cmd_stats(json),
        "help" | "--help" | "-h" | "" => {
            print_help();
            return ExitCode::SUCCESS;
        }
        other => Err(format!("Unknown command: {other}")),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
