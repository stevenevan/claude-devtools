//! Ports `agents_write_test.go` — the exported agent-writer API cases. Uses
//! canonicalized temp dirs (never real files). `TestDeleteRestoreRoundTrip` is
//! omitted: it exercises `internal/maintenance`, outside W12's two-file scope.

use super::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn make_temp_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "agents-write-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    // Canonicalize so /var/folders → /private/... matches confine's canon side.
    fs::canonicalize(&dir).unwrap()
}

fn agent_test_root() -> PathBuf {
    let root = make_temp_dir("root");
    fs::create_dir_all(root.join("agents")).unwrap();
    root
}

fn seed_agent(root: &Path, file_base: &str, content: &str) -> PathBuf {
    let p = root.join("agents").join(format!("{file_base}.md"));
    fs::write(&p, content).unwrap();
    p
}

const FULL_AGENT: &str = "---\n\
name: test-agent\n\
description: A test agent\n\
tools: Read, Write\n\
model: sonnet\n\
color: purple\n\
emoji: sparkles\n\
vibe: chill\n\
---\n\
\n\
You are a test agent.\n\
Do things.\n";

#[test]
fn patch_preserves_body_and_unknown_keys() {
    let root = agent_test_root();
    let dest = seed_agent(&root, "test-agent", FULL_AGENT);

    patch_agent_frontmatter(
        root.to_str().unwrap(),
        "test-agent",
        AgentPatch {
            model: Some("opus".into()),
            ..Default::default()
        },
    )
    .unwrap();

    let got = fs::read_to_string(&dest).unwrap();
    let want = FULL_AGENT.replace("model: sonnet\n", "model: opus\n");
    assert_eq!(got, want, "only the touched key line should change");
    assert!(
        got.ends_with("\n---\n\nYou are a test agent.\nDo things.\n"),
        "body not preserved: {got:?}"
    );
    for unknown in ["color: purple", "emoji: sparkles", "vibe: chill"] {
        assert!(got.contains(unknown), "unknown key {unknown:?} not preserved");
    }
    let bak = fs::read_to_string(format!("{}.bak", dest.display())).unwrap();
    assert_eq!(bak, FULL_AGENT, ".bak must hold pre-patch bytes");
}

#[test]
fn patch_appends_absent_key() {
    let root = agent_test_root();
    let seed = "---\nname: minimal\ndescription: min\n---\n\nBody.\n";
    let dest = seed_agent(&root, "minimal", seed);

    patch_agent_frontmatter(
        root.to_str().unwrap(),
        "minimal",
        AgentPatch {
            model: Some("haiku".into()),
            ..Default::default()
        },
    )
    .unwrap();

    let got = fs::read_to_string(&dest).unwrap();
    assert_eq!(
        got,
        "---\nname: minimal\ndescription: min\nmodel: haiku\n---\n\nBody.\n"
    );
}

#[test]
fn patch_body_replace_keeps_frontmatter() {
    let root = agent_test_root();
    let dest = seed_agent(&root, "test-agent", FULL_AGENT);

    let new_body = "Completely new body.\n";
    patch_agent_frontmatter(
        root.to_str().unwrap(),
        "test-agent",
        AgentPatch {
            body: Some(new_body.into()),
            ..Default::default()
        },
    )
    .unwrap();

    let got = fs::read_to_string(&dest).unwrap();
    let idx = FULL_AGENT.find("---\n\nYou").unwrap() + "---\n".len();
    let want = format!("{}{}", &FULL_AGENT[..idx], new_body);
    assert_eq!(got, want, "body-replace must keep frontmatter byte-identical");
}

#[test]
fn patch_refuses_block_scalar_value() {
    let cases = [
        (
            "folded-indicator",
            "---\nname: blocky\ndescription: >\n  A folded\n  description here\nmodel: opus\n---\n\nBody.\n",
        ),
        (
            "indented-cont",
            "---\nname: multi\ndescription: first line\n  continuation\nmodel: opus\n---\n\nBody.\n",
        ),
    ];
    for (label, seed) in cases {
        let root = agent_test_root();
        let dest = seed_agent(&root, "agent", seed);

        let result = patch_agent_frontmatter(
            root.to_str().unwrap(),
            "agent",
            AgentPatch {
                description: Some("new".into()),
                ..Default::default()
            },
        );
        assert!(result.is_err(), "{label}: expected block-scalar refusal");

        let got = fs::read_to_string(&dest).unwrap();
        assert_eq!(got, seed, "{label}: file must be unchanged on refusal");
        assert!(
            !Path::new(&format!("{}.bak", dest.display())).exists(),
            "{label}: no .bak should be written on refusal"
        );
    }
}

#[test]
fn create_agent_template_reparses() {
    let root = agent_test_root();
    create_agent(root.to_str().unwrap(), "fresh-agent", "A fresh agent").unwrap();

    let agents = read_managed_agents(root.to_str().unwrap()).unwrap();
    let found = agents
        .iter()
        .find(|a| a.name == "fresh-agent")
        .expect("created agent should re-parse into read_managed_agents");
    assert_eq!(
        found.description, "\"A fresh agent\"",
        "description keeps its quotes (naive parser)"
    );
}

#[test]
fn create_agent_escapes_quotes_and_backslashes() {
    let root = agent_test_root();
    create_agent(
        root.to_str().unwrap(),
        "quoted",
        r#"has "quotes" and \ backslash"#,
    )
    .unwrap();

    let raw = fs::read_to_string(root.join("agents").join("quoted.md")).unwrap();
    assert!(
        raw.contains(r#"description: "has \"quotes\" and \\ backslash""#),
        "quotes/backslashes not escaped: {raw:?}"
    );
    let agents = read_managed_agents(root.to_str().unwrap()).unwrap();
    assert!(
        agents.iter().any(|a| a.name == "quoted"),
        "escaped-description agent did not re-parse a name"
    );
}

#[test]
fn create_agent_rejects_duplicate() {
    let root = agent_test_root();
    create_agent(root.to_str().unwrap(), "dup", "first").unwrap();
    assert!(
        create_agent(root.to_str().unwrap(), "dup", "second").is_err(),
        "expected duplicate agent name to be rejected"
    );
}

#[test]
fn create_agent_rejects_newline_description() {
    let root = agent_test_root();
    for desc in ["line1\nline2", "carriage\rreturn"] {
        assert!(
            create_agent(root.to_str().unwrap(), "nl", desc).is_err(),
            "expected newline description {desc:?} to be rejected"
        );
    }
    assert!(
        !root.join("agents").join("nl.md").exists(),
        "no file should be written for a rejected description"
    );
}

#[test]
fn resolve_agent_path_rejects_unsafe_names() {
    let root = agent_test_root();
    for bad in ["../evil", "a/b", "", ".", "..", "/abs/path"] {
        assert!(
            resolve_agent_path(root.to_str().unwrap(), bad).is_err(),
            "expected resolve_agent_path({bad:?}) to be rejected"
        );
    }
}
