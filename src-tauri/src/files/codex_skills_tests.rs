use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::config::codex_context::normalize_project_context;
use crate::types::codex_inventory::{CodexEnabledState, CodexInventoryScope, CodexValidationState};

fn fixture(name: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codex-skills-{name}-{nonce}"));
    fs::create_dir_all(&root).expect("fixture root");
    root
}

#[test]
fn inventory_reports_metadata_resources_and_configured_state_without_running_scripts() {
    let root = fixture("inventory");
    let project = root.join("project");
    let skill = project.join(".agents/skills/research");
    fs::create_dir_all(skill.join("scripts")).expect("skill");
    fs::write(
        skill.join("SKILL.md"),
        "---\nname: research\ndescription: Gather sources\n---\n\nBody\n",
    )
    .expect("skill doc");
    let sentinel = root.join("script-ran");
    fs::write(
        skill.join("scripts/run.sh"),
        format!("touch {}\n", sentinel.display()),
    )
    .expect("script");
    fs::write(
        root.join("config.toml"),
        "[skills]\n[[skills.config]]\nname = \"research\"\nenabled = false\n",
    )
    .expect("config");
    fs::create_dir_all(project.join(".agents/skills/missing")).expect("missing skill");
    fs::create_dir_all(project.join(".agents/skills/malformed")).expect("malformed skill dir");
    fs::write(
        project.join(".agents/skills/malformed/SKILL.md"),
        "---\nname: malformed\n",
    )
    .expect("malformed skill");

    let context = normalize_project_context(&project.to_string_lossy(), None, None, "codex skills")
        .expect("context");
    let scope = CodexInventoryScope::Project {
        project_id: "project-1".to_string(),
    };
    let inventory = discover(&root, &scope, Some(&context)).expect("discover");
    let research = inventory
        .view
        .items
        .iter()
        .find(|item| item.name == "research")
        .expect("research");
    assert_eq!(research.enabled_state, CodexEnabledState::Disabled);
    assert!(research
        .resources
        .iter()
        .any(|resource| resource.relative_path == ".agents/skills/research/scripts/run.sh"));
    assert!(!sentinel.exists());
    assert!(inventory
        .view
        .items
        .iter()
        .any(|item| item.state == CodexValidationState::Missing));
    assert!(inventory
        .view
        .items
        .iter()
        .any(|item| item.state == CodexValidationState::Malformed));
    let record = inventory
        .records
        .iter()
        .find(|record| record.summary.name == "research")
        .expect("research record");
    let detail = read_detail(record, 8).expect("detail");
    assert_eq!(detail.content, "---\nnam");
    assert!(detail.truncated);
    assert!(detail.untrusted);
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn linked_skill_directories_are_read_only_and_external_targets_are_labeled() {
    let root = fixture("symlink");
    let project = root.join("project");
    let source = root.join("external");
    fs::create_dir_all(&source).expect("source");
    fs::write(source.join("SKILL.md"), "external skill").expect("source skill");
    fs::create_dir_all(project.join(".agents/skills")).expect("skill root");
    std::os::unix::fs::symlink(&source, project.join(".agents/skills/linked")).expect("link");
    let context = normalize_project_context(&project.to_string_lossy(), None, None, "codex skills")
        .expect("context");
    let inventory = discover(
        &root,
        &CodexInventoryScope::Project {
            project_id: "project-1".to_string(),
        },
        Some(&context),
    )
    .expect("discover");
    let linked = inventory
        .view
        .items
        .iter()
        .find(|item| item.name == "linked")
        .expect("linked");
    assert!(linked.symlink);
    assert!(linked.external_target);
    let _ = fs::remove_dir_all(root);
}
