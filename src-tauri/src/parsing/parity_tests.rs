//! Parser fixture gate: parse each committed synthetic fixture and assert the
//! Rust parser canon-matches its committed message and detail goldens.

use std::fs;
use std::path::{Path, PathBuf};

use crate::analysis::chunk_builder::build_session_detail;
use crate::parsing::session_parser::parse_jsonl_file;
use crate::testutil::{canon, canon_str};
use crate::types::domain::Session;

fn fixtures() -> Vec<PathBuf> {
    let dir = Path::new("tests/fixtures/parity");
    fs::read_dir(dir)
        .expect("read testdata dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .collect()
}

#[test]
fn messages_match_go_goldens() {
    // cargo runs tests with CWD = crate root (src-tauri).
    let mut checked = 0;
    for path in fixtures() {
        let stem = path.file_stem().unwrap().to_str().unwrap().to_string();
        let golden = path.with_file_name(format!("{stem}.messages.golden.json"));
        let (messages, _meta) = parse_jsonl_file(&path).expect("parse fixture");
        let golden_json = fs::read_to_string(&golden)
            .unwrap_or_else(|e| panic!("read committed message golden for {stem}: {e}"));
        assert_eq!(
            canon(&messages),
            canon_str(&golden_json),
            "parser parity for {stem}"
        );
        checked += 1;
    }
    assert!(checked > 0, "no *.jsonl fixtures found");
}

// Stub keeps the detail golden dependent only on fixture messages.
fn stub_session(
    name: &str,
    message_count: usize,
    meta_custom: Option<String>,
    meta_agent: Option<String>,
) -> Session {
    Session {
        id: name.to_string(),
        project_id: "paritytest".to_string(),
        project_path: String::new(),
        todo_data: None,
        created_at: 0.0,
        first_message: None,
        message_timestamp: None,
        has_subagents: false,
        message_count: message_count as u32,
        cost_usd: None,
        is_ongoing: Some(false),
        git_branch: None,
        metadata_level: Some("deep".to_string()),
        context_consumption: None,
        compaction_count: None,
        phase_breakdown: None,
        custom_title: meta_custom,
        agent_name: meta_agent,
    }
}

#[test]
fn session_detail_matches_go_goldens() {
    let mut checked = 0;
    for path in fixtures() {
        let stem = path.file_stem().unwrap().to_str().unwrap().to_string();
        let golden = path.with_file_name(format!("{stem}.detail.golden.json"));
        let (messages, meta) = parse_jsonl_file(&path).expect("parse fixture");
        let session = stub_session(
            &stem,
            messages.len(),
            meta.custom_title.clone(),
            meta.agent_name.clone(),
        );
        let detail = build_session_detail(session, messages, vec![]);
        let golden_json = fs::read_to_string(&golden)
            .unwrap_or_else(|e| panic!("read committed detail golden for {stem}: {e}"));
        assert_eq!(
            canon(&detail),
            canon_str(&golden_json),
            "session detail parity for {stem}"
        );
        checked += 1;
    }
    assert!(checked > 0, "no *.jsonl fixtures found");
}
