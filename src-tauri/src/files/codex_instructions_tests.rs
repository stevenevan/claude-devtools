use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::config::codex_context::normalize_project_context;
use crate::types::codex_inventory::CodexInventoryScope;

fn fixture(name: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codex-instructions-{name}-{nonce}"));
    fs::create_dir_all(&root).expect("fixture root");
    root
}

#[test]
fn global_scope_chooses_the_first_non_empty_document() {
    let root = fixture("global");
    fs::write(root.join("AGENTS.override.md"), "\n").expect("empty override");
    fs::write(root.join("AGENTS.md"), "global instructions").expect("global document");

    let inventory = discover(&root, &CodexInventoryScope::Global, None).expect("discover");
    assert_eq!(inventory.view.items.len(), 1);
    assert_eq!(inventory.view.items[0].identity.relative_path, "AGENTS.md");
    assert_eq!(inventory.view.items[0].priority, 0);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn project_scope_merges_root_to_current_and_honors_cumulative_limit() {
    let root = fixture("project");
    let nested = root.join("src");
    fs::create_dir_all(&nested).expect("nested");
    fs::write(root.join("AGENTS.md"), "root guidance").expect("root guidance");
    fs::write(nested.join("AGENTS.override.md"), "nested guidance").expect("nested guidance");
    fs::write(root.join("config.toml"), "project_doc_max_bytes = 12\n").expect("config");
    let context = normalize_project_context(
        &root.to_string_lossy(),
        Some(&nested.to_string_lossy()),
        None,
        "codex instructions",
    )
    .expect("context");

    let inventory = discover(
        &root,
        &CodexInventoryScope::Project {
            project_id: "project-1".to_string(),
        },
        Some(&context),
    )
    .expect("discover");
    assert_eq!(inventory.view.items.len(), 1);
    assert_eq!(inventory.view.items[0].identity.relative_path, "AGENTS.md");
    assert!(inventory.view.summary.scan_limited);
    assert_eq!(inventory.view.summary.omitted_count, 1);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn detail_is_bounded_and_labels_text_as_untrusted() {
    let root = fixture("detail");
    fs::write(root.join("AGENTS.md"), "untrusted guidance").expect("document");
    let inventory = discover(&root, &CodexInventoryScope::Global, None).expect("discover");
    let detail = read_detail(&inventory.records[0], 8).expect("detail");
    assert_eq!(detail.content, "untrust");
    assert!(detail.truncated);
    assert!(detail.untrusted);
    let encoded = serde_json::to_string(&detail).expect("serialize");
    assert!(!encoded.contains(&root.to_string_lossy().to_string()));
    let _ = fs::remove_dir_all(root);
}
