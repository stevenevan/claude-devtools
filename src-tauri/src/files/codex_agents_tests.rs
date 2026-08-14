use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::types::codex_inventory::{CodexInventoryScope, CodexValidationState};

fn fixture(name: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codex-agents-{name}-{nonce}"));
    fs::create_dir_all(&root).expect("fixture root");
    root
}

#[test]
fn metadata_is_bounded_and_declared_capabilities_stay_unresolved() {
    let root = fixture("metadata");
    let agents = root.join("agents");
    fs::create_dir_all(&agents).expect("agents");
    fs::write(
        agents.join("reviewer.toml"),
        r#"name = "reviewer"
description = "Reviews changes"
developer_instructions = "Do not execute local content"
model = "inherit"
tools = ["read", "shell"]
skills = ["research"]
unknown_field = "not displayed"
"#,
    )
    .expect("agent");

    let inventory = discover(&root, &CodexInventoryScope::Global, None).expect("discover");
    let agent = &inventory.view.items[0];
    assert_eq!(agent.name, "reviewer");
    assert!(agent.developer_instructions_available);
    assert!(agent
        .declared_capabilities
        .iter()
        .all(|capability| !capability.resolved));
    assert!(agent
        .diagnostics
        .iter()
        .any(|item| item.code == "unknown-field"));
    let detail = read_detail(&inventory.records[0], 256).expect("detail");
    assert_eq!(
        detail.developer_instructions.as_deref(),
        Some("Do not execute local content")
    );
    assert!(detail.untrusted);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn editing_developer_instructions_preserves_unknown_agent_fields() {
    let current = r#"name = "reviewer"
unknown_field = "keep this field"
developer_instructions = "old"
"#;
    let rendered = render_developer_instructions(current, "new instructions").expect("render");
    let document: toml_edit::DocumentMut = rendered.parse().expect("parse rendered");
    assert_eq!(
        document.get("unknown_field").and_then(|item| item.as_str()),
        Some("keep this field")
    );
    assert_eq!(
        document
            .get("developer_instructions")
            .and_then(|item| item.as_str()),
        Some("new instructions")
    );
}

#[test]
fn malformed_agent_does_not_hide_a_valid_sibling() {
    let root = fixture("malformed");
    let agents = root.join("agents");
    fs::create_dir_all(&agents).expect("agents");
    fs::write(agents.join("bad.toml"), "name = [\n").expect("bad");
    fs::write(agents.join("good.toml"), "name = \"good\"\n").expect("good");

    let inventory = discover(&root, &CodexInventoryScope::Global, None).expect("discover");
    assert_eq!(inventory.view.items.len(), 2);
    assert!(inventory
        .view
        .items
        .iter()
        .any(|item| item.state == CodexValidationState::Malformed));
    assert!(inventory.view.items.iter().any(|item| item.name == "good"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn duplicate_names_keep_distinct_source_ids() {
    let root = fixture("duplicate");
    let agents = root.join("agents");
    fs::create_dir_all(&agents).expect("agents");
    fs::write(agents.join("same.toml"), "name = \"same\"\n").expect("global");
    let global = discover(&root, &CodexInventoryScope::Global, None).expect("global");

    let project = root.join("project");
    let project_agents = project.join(".codex/agents");
    fs::create_dir_all(&project_agents).expect("project agents");
    fs::write(project_agents.join("same.toml"), "name = \"same\"\n").expect("project");
    let context = crate::config::codex_context::normalize_project_context(
        &project.to_string_lossy(),
        None,
        None,
        "codex agents",
    )
    .expect("context");
    let local = discover(
        &root,
        &CodexInventoryScope::Project {
            project_id: "project-1".to_string(),
        },
        Some(&context),
    )
    .expect("project");
    assert_ne!(
        global.view.items[0].identity.id,
        local.view.items[0].identity.id
    );
    let _ = fs::remove_dir_all(root);
}
