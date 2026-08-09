//! claude-devtools-cli (sprint 53)
//!
//! Read-only CLI for inspecting Claude session data.
//!
//! Subcommands:
//!   list-projects                  List projects
//!   list-sessions <project>        List sessions for a project
//!   show-session <project> <id>    Show session detail (--format json|markdown)
//!   tail <project> <id>            Tail session JSONL (rate-limited)
//!   stats                          Aggregate counts
//!
//! Append --json to list-projects / list-sessions / stats for JSON output.
//! show-session uses --format (json or markdown).
//!
//! Security guards (sprint 53):
//!   - Symlink-safe canonicalization keeps file access under home/.claude
//!   - Project / session IDs restricted to ASCII alnum, dash, underscore, dot
//!   - CLAUDE_HOME / HOME env overrides ignored; dirs::home_dir() resolved once
//!   - tail caps emit at 10 MB/s and 100_000 lines per invocation

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use claude_devtools_lib::analysis::chunk_builder;
use claude_devtools_lib::analytics;
use claude_devtools_lib::discovery::path_decoder;
use claude_devtools_lib::discovery::project_scanner;
use claude_devtools_lib::discovery::session_lister;
use claude_devtools_lib::discovery::subproject_registry::SubprojectRegistry;
use claude_devtools_lib::discovery::{ongoing_detector, subagent_resolver};
use claude_devtools_lib::insights;
use claude_devtools_lib::parsing::session_parser;
use claude_devtools_lib::types::domain::{Session, SessionsPaginationOptions};

const TAIL_BYTES_PER_SEC: usize = 10 * 1024 * 1024;
const TAIL_MAX_LINES: usize = 100_000;
const MAX_ID_LEN: usize = 200;

fn resolve_home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "cannot resolve home directory (no fallback)".to_string())
}

fn claude_dir() -> Result<PathBuf, String> {
    Ok(resolve_home()?.join(".claude"))
}

fn projects_dir() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("projects"))
}

fn validate_id(kind: &str, raw: &str) -> Result<(), String> {
    if raw.is_empty() {
        return Err(format!("{kind} is empty"));
    }
    if raw.len() > MAX_ID_LEN {
        return Err(format!("{kind} exceeds {MAX_ID_LEN} chars"));
    }
    for ch in raw.chars() {
        if ch.is_control() || ch == '\0' {
            return Err(format!("{kind} contains control character"));
        }
        if ch == '/' || ch == '\\' || ch == ':' {
            return Err(format!("{kind} contains path separator"));
        }
        let allowed =
            ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' || ch == '+';
        if !allowed {
            return Err(format!("{kind} contains disallowed character '{ch}'"));
        }
    }
    if raw == "." || raw == ".." {
        return Err(format!("{kind} cannot be '.' or '..'"));
    }
    Ok(())
}

fn validate_under_root(candidate: &Path, root: &Path) -> Result<PathBuf, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("root canonicalization failed: {e}"))?;
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("path outside session root: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("path outside session root".to_string());
    }
    Ok(canonical)
}

fn session_path(project_id: &str, session_id: &str) -> Result<PathBuf, String> {
    validate_id("project_id", project_id)?;
    validate_id("session_id", session_id)?;

    let base = if let Some(idx) = project_id.find("::") {
        let lhs = &project_id[..idx];
        validate_id("project_id (base)", lhs)?;
        lhs.to_string()
    } else {
        project_id.to_string()
    };

    let root = projects_dir()?;
    let project_dir = root.join(&base);
    if !project_dir.exists() {
        return Err(format!("project '{base}' not found"));
    }
    let _ = validate_under_root(&project_dir, &root)?;

    let candidate = project_dir.join(format!("{session_id}.jsonl"));
    if !candidate.exists() {
        return Err(format!("session '{session_id}' not found in '{base}'"));
    }
    let canonical = validate_under_root(&candidate, &root)?;
    Ok(canonical)
}

fn cmd_list_projects(json: bool) -> Result<(), String> {
    let mut registry = SubprojectRegistry::new();
    let projects = project_scanner::scan_projects(&projects_dir()?, &mut registry)?;
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

fn cmd_list_sessions(project_id: &str, json: bool) -> Result<(), String> {
    validate_id("project_id", project_id)?;
    let opts = SessionsPaginationOptions::default();
    let registry = SubprojectRegistry::new();
    let result = session_lister::list_sessions_paginated(
        &projects_dir()?,
        &claude_dir()?,
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

fn cmd_show_session(project_id: &str, session_id: &str, format: &str) -> Result<(), String> {
    let session_path = session_path(project_id, session_id)?;
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
        cost_usd: None,
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
    match format {
        "json" => {
            let payload = serde_json::to_string(&detail).map_err(|e| e.to_string())?;
            println!("{payload}");
        }
        "markdown" => {
            println!("# Session `{session_id}`\n");
            println!("- Chunks: {}", detail.chunks.len());
            println!("- Messages: {}", detail.messages.len());
            println!(
                "- Tokens: total={} input={} output={} cache_read={}",
                detail.metrics.total_tokens,
                detail.metrics.input_tokens,
                detail.metrics.output_tokens,
                detail.metrics.cache_read_tokens
            );
            if let Some(cost) = detail.metrics.cost_usd {
                println!("- Cost USD: ${cost:.4}");
            }
        }
        other => return Err(format!("unknown --format '{other}' (use json|markdown)")),
    }
    Ok(())
}

fn cmd_dump_messages(project_id: &str, session_id: &str) -> Result<(), String> {
    let (messages, _) = session_parser::parse_jsonl_file(&session_path(project_id, session_id)?)?;
    emit_json(&messages)
}

fn cmd_dump_detail(project_id: &str, session_id: &str) -> Result<(), String> {
    let path = session_path(project_id, session_id)?;
    let parsed = session_parser::parse_session_file(&path)?;
    let projects = projects_dir()?;
    let subagents = subagent_resolver::resolve_subagents(
        &projects,
        project_id,
        session_id,
        &parsed.task_calls,
        &parsed.messages,
    );
    let session = Session {
        id: session_id.to_string(),
        project_id: project_id.to_string(),
        project_path: path_decoder::decode_path(&path_decoder::extract_base_dir(project_id)),
        todo_data: None,
        created_at: 0.0,
        first_message: None,
        message_timestamp: None,
        has_subagents: !subagents.is_empty(),
        message_count: parsed.messages.len() as u32,
        cost_usd: None,
        is_ongoing: ongoing_detector::detect_ongoing(&path),
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
        custom_title: parsed.custom_title.clone(),
        agent_name: parsed.agent_name.clone(),
    };
    emit_json(&chunk_builder::build_session_detail(
        session,
        parsed.messages,
        subagents,
    ))
}

fn cmd_tail(project_id: &str, session_id: &str) -> Result<(), String> {
    let path = session_path(project_id, session_id)?;
    let file = std::fs::File::open(&path).map_err(|e| format!("open failed: {e}"))?;
    let reader = BufReader::new(file);

    let stdout = std::io::stdout();
    let mut lock = stdout.lock();

    let start = Instant::now();
    let mut bytes_written: usize = 0;
    let mut lines_written: usize = 0;

    for line in reader.lines() {
        if lines_written >= TAIL_MAX_LINES {
            eprintln!("tail: line cap ({TAIL_MAX_LINES}) reached; stopping");
            break;
        }
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let bytes = line.len() + 1;
        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let target_bytes = (TAIL_BYTES_PER_SEC as f64 * elapsed) as usize;
        if bytes_written + bytes > target_bytes {
            let over = (bytes_written + bytes).saturating_sub(target_bytes);
            let nap = (over as f64) / (TAIL_BYTES_PER_SEC as f64);
            if nap > 0.0 {
                std::thread::sleep(Duration::from_secs_f64(nap.min(1.0)));
            }
        }
        lock.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        lock.write_all(b"\n").map_err(|e| e.to_string())?;
        bytes_written += bytes;
        lines_written += 1;
    }
    let _ = lock.flush();
    Ok(())
}

fn cmd_stats(json: bool) -> Result<(), String> {
    let mut registry = SubprojectRegistry::new();
    let projects = project_scanner::scan_projects(&projects_dir()?, &mut registry)?;
    let mut total_sessions: usize = 0;
    let mut total_messages: u64 = 0;
    for p in &projects {
        let opts = SessionsPaginationOptions::default();
        if let Ok(result) = session_lister::list_sessions_paginated(
            &projects_dir()?,
            &claude_dir()?,
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

fn print_help() {
    println!(
        "claude-devtools-cli\n\nUSAGE:\n  claude-devtools-cli list-projects [--json]\n  claude-devtools-cli list-sessions <project_id> [--json]\n  claude-devtools-cli show-session <project_id> <session_id> [--format json|markdown]\n  claude-devtools-cli tail <project_id> <session_id>\n  claude-devtools-cli stats [--json]\n"
    );
}

fn flag(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}

fn flag_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        if a == name {
            return iter.next().map(|s| s.as_str());
        }
        if let Some(rest) = a.strip_prefix(&format!("{name}=")) {
            return Some(rest);
        }
    }
    None
}

fn run(args: Vec<String>) -> Result<(), String> {
    let json = flag(&args, "--json");
    let format = flag_value(&args, "--format").unwrap_or("json");
    let positional: Vec<&str> = args
        .iter()
        .filter(|a| !a.starts_with("--"))
        .map(String::as_str)
        .collect();

    let cmd = positional.first().copied().unwrap_or("");
    match cmd {
        "list-projects" | "list" => cmd_list_projects(json),
        "list-sessions" | "sessions" => match positional.get(1) {
            Some(p) => cmd_list_sessions(p, json),
            None => Err("list-sessions requires <project_id>".to_string()),
        },
        "show-session" | "show" => match (positional.get(1), positional.get(2)) {
            (Some(p), Some(s)) => cmd_show_session(p, s, format),
            _ => Err("show-session requires <project_id> <session_id>".to_string()),
        },
        "dump-messages" => match (positional.get(1), positional.get(2)) {
            (Some(p), Some(s)) => cmd_dump_messages(p, s),
            _ => Err("dump-messages requires <project_id> <session_id>".to_string()),
        },
        "dump-detail" => match (positional.get(1), positional.get(2)) {
            (Some(p), Some(s)) => cmd_dump_detail(p, s),
            _ => Err("dump-detail requires <project_id> <session_id>".to_string()),
        },
        "tail" => match (positional.get(1), positional.get(2)) {
            (Some(p), Some(s)) => cmd_tail(p, s),
            _ => Err("tail requires <project_id> <session_id>".to_string()),
        },
        "stats" => cmd_stats(json),
        "dump-analytics" => match positional.get(1) {
            Some(d) => cmd_dump_analytics(d),
            None => Err("dump-analytics requires <days>".to_string()),
        },
        "dump-productivity" => match positional.get(1) {
            Some(d) => cmd_dump_productivity(d),
            None => Err("dump-productivity requires <days>".to_string()),
        },
        "dump-duration" => match positional.get(1) {
            Some(d) => cmd_dump_duration(d),
            None => Err("dump-duration requires <days>".to_string()),
        },
        "dump-model-comparison" => match positional.get(1) {
            Some(d) => cmd_dump_model_comparison(d),
            None => Err("dump-model-comparison requires <days>".to_string()),
        },
        "dump-cost-forecast" => match positional.get(1) {
            Some(d) => cmd_dump_cost_forecast(d),
            None => Err("dump-cost-forecast requires <windowDays>".to_string()),
        },
        "dump-tool-analytics" => match (positional.get(1), positional.get(2)) {
            (Some(p), Some(d)) => cmd_dump_tool_analytics(p, d),
            _ => Err("dump-tool-analytics requires <project_id> <days>".to_string()),
        },
        "dump-tool-heatmap" => match (positional.get(1), positional.get(2)) {
            (Some(p), Some(d)) => {
                cmd_dump_tool_heatmap(p, d, positional.get(3).copied().unwrap_or(""))
            }
            _ => Err("dump-tool-heatmap requires <project_id> <days> [toolFilter]".to_string()),
        },
        "dump-error-hotspots" => match (positional.get(1), positional.get(2), positional.get(3)) {
            (Some(p), Some(d), Some(m)) => cmd_dump_error_hotspots(p, d, m),
            _ => {
                Err("dump-error-hotspots requires <project_id> <days> <minOccurrences>".to_string())
            }
        },
        "dump-error-clusters" => match (positional.get(1), positional.get(2), positional.get(3)) {
            (Some(p), Some(d), Some(m)) => cmd_dump_error_clusters(p, d, m),
            _ => {
                Err("dump-error-clusters requires <project_id> <days> <minClusterSize>".to_string())
            }
        },
        "dump-file-graph" => match (positional.get(1), positional.get(2)) {
            (Some(p), Some(s)) => cmd_dump_file_graph(p, s),
            _ => Err("dump-file-graph requires <project_id> <session_id>".to_string()),
        },
        "help" | "--help" | "-h" | "" => {
            print_help();
            Ok(())
        }
        other => Err(format!("Unknown command: {other}")),
    }
}

// The W8 analytics dumps mirror cmd/cli's dump-* and Go analytics.Compute*.
// They take only an integer window (no path arg) and resolve the corpus from
// $HOME, so they carry no path-injection surface (no validate_id needed — the
// whole-project scanners with a project arg are W9). Parity is verified live vs
// the Go CLI over a synthetic $HOME (internal/paritytest, W8 Step 5).

fn parse_days(arg: &str) -> Result<u32, String> {
    arg.parse::<u32>()
        .map_err(|e| format!("invalid days arg {arg:?}: {e}"))
}

fn emit_json<T: serde::Serialize>(value: &T) -> Result<(), String> {
    let payload = serde_json::to_string(value).map_err(|e| e.to_string())?;
    println!("{payload}");
    Ok(())
}

fn cmd_dump_analytics(days_arg: &str) -> Result<(), String> {
    emit_json(&analytics::compute_analytics(parse_days(days_arg)?)?)
}

fn cmd_dump_productivity(days_arg: &str) -> Result<(), String> {
    emit_json(&analytics::compute_productivity_metrics(parse_days(
        days_arg,
    )?)?)
}

fn cmd_dump_duration(days_arg: &str) -> Result<(), String> {
    emit_json(&analytics::compute_session_duration_stats(parse_days(
        days_arg,
    )?)?)
}

fn cmd_dump_model_comparison(days_arg: &str) -> Result<(), String> {
    emit_json(&analytics::compute_model_comparison(parse_days(days_arg)?)?)
}

fn cmd_dump_cost_forecast(window_arg: &str) -> Result<(), String> {
    emit_json(&analytics::compute_cost_forecast(parse_days(window_arg)?)?)
}

// W9 insights dumps. The whole-project scanners take a <project> arg but no
// <session>, so session_path can't guard them — each validate_id's the project
// before compute (resolve_project_dir builds the corpus path by raw join). file
// -graph takes both ids and is guarded by the session_path chain like Go's twin.

fn cmd_dump_tool_analytics(project_id: &str, days_arg: &str) -> Result<(), String> {
    validate_id("project_id", project_id)?;
    emit_json(&insights::tool_analytics::compute_tool_analytics(
        project_id,
        parse_days(days_arg)?,
    )?)
}

fn cmd_dump_tool_heatmap(
    project_id: &str,
    days_arg: &str,
    tool_filter: &str,
) -> Result<(), String> {
    validate_id("project_id", project_id)?;
    let filter = if tool_filter.is_empty() {
        None
    } else {
        Some(tool_filter)
    };
    emit_json(&insights::tool_analytics::compute_tool_time_heatmap(
        project_id,
        parse_days(days_arg)?,
        filter,
    )?)
}

fn cmd_dump_error_hotspots(project_id: &str, days_arg: &str, min_arg: &str) -> Result<(), String> {
    validate_id("project_id", project_id)?;
    emit_json(&insights::error_hotspots::compute_error_hotspots(
        project_id,
        parse_days(days_arg)?,
        parse_days(min_arg)?,
    )?)
}

fn cmd_dump_error_clusters(project_id: &str, days_arg: &str, min_arg: &str) -> Result<(), String> {
    validate_id("project_id", project_id)?;
    emit_json(&insights::error_hotspots::compute_error_clusters(
        project_id,
        parse_days(days_arg)?,
        parse_days(min_arg)?,
    )?)
}

fn cmd_dump_file_graph(project_id: &str, session_id: &str) -> Result<(), String> {
    // Guard both ids + confine under root, then resolve the projects root (what
    // the service passes when canonicalRoot is empty).
    session_path(project_id, session_id)?;
    let root = projects_dir()?;
    emit_json(&insights::file_graph::compute_file_graph(
        &root, project_id, session_id,
    )?)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_separator_in_id() {
        assert!(validate_id("project_id", "../etc/passwd").is_err());
        assert!(validate_id("project_id", "foo/bar").is_err());
        assert!(validate_id("project_id", "foo\\bar").is_err());
    }

    #[test]
    fn rejects_control_chars() {
        assert!(validate_id("session_id", "foo\u{0}bar").is_err());
        assert!(validate_id("session_id", "foo\u{1B}bar").is_err());
        assert!(validate_id("session_id", "foo\nbar").is_err());
    }

    #[test]
    fn rejects_empty_and_dot_dot() {
        assert!(validate_id("session_id", "").is_err());
        assert!(validate_id("session_id", "..").is_err());
        assert!(validate_id("session_id", ".").is_err());
    }

    #[test]
    fn rejects_too_long() {
        let s = "a".repeat(MAX_ID_LEN + 1);
        assert!(validate_id("session_id", &s).is_err());
    }

    #[test]
    fn accepts_valid_ids() {
        assert!(validate_id("project_id", "-Users-name-project").is_ok());
        assert!(validate_id("session_id", "abc-123_v2.5").is_ok());
    }

    #[test]
    fn dump_commands_require_both_ids() {
        assert!(run(vec!["dump-messages".to_string()]).is_err());
        assert!(run(vec!["dump-detail".to_string()]).is_err());
    }

    #[test]
    fn validate_under_root_rejects_outside() {
        let tmp = std::env::temp_dir();
        let outside = std::path::PathBuf::from("/etc");
        let res = validate_under_root(&outside, &tmp);
        assert!(res.is_err(), "expected outside-root rejection");
    }
}
