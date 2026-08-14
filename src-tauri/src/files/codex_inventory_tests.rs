use std::fs;
use std::path::Path;

use super::*;
use crate::types::codex_inventory::{CodexInventoryScope, CodexRecordKind};

fn fixture(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("codex-inventory-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("fixture root");
    path
}

#[test]
fn confined_reads_reject_traversal_and_symlink_escape() {
    let root = fixture("confined");
    let outside = root.join("outside.txt");
    fs::write(&outside, "outside").expect("outside");
    fs::write(root.join("inside.txt"), "inside").expect("inside");

    assert!(confined_path(&root, Path::new("../outside.txt")).is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&outside, root.join("linked.txt")).expect("symlink");
        assert!(confined_path(&root, Path::new("linked.txt")).is_err());
        assert!(read_bounded_relative(&root, Path::new("linked.txt"), 32).is_err());
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn bounded_reads_report_truncation_without_exceeding_the_limit() {
    let root = fixture("bounded");
    fs::write(root.join("document.md"), "abcdef").expect("document");
    let result = read_bounded_relative(&root, Path::new("document.md"), 3).expect("read");
    assert_eq!(result.text, "abc");
    assert!(result.truncated);
    assert_eq!(result.bytes_read, 3);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn source_ids_are_stable_but_exact_revisions_change_with_content() {
    let scope = CodexInventoryScope::Project {
        project_id: "project-id".to_string(),
    };
    let first = source_identity(&scope, CodexRecordKind::Agent, "agents/reviewer.toml");
    let second = source_identity(&scope, CodexRecordKind::Agent, "agents/reviewer.toml");
    assert_eq!(first, second);

    let root = fixture("revision");
    let path = root.join("file");
    fs::write(&path, "one").expect("first");
    let revision_one = exact_revision(&path).expect("revision one");
    fs::write(&path, "two").expect("second");
    let revision_two = exact_revision(&path).expect("revision two");
    assert_ne!(revision_one, revision_two);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn readonly_skill_resolution_allows_a_link_but_marks_external_targets() {
    let root = fixture("skill-link");
    let target = root.join("external-skill");
    fs::create_dir_all(&target).expect("target");
    #[cfg(unix)]
    {
        let skills = root.join("skills");
        fs::create_dir_all(&skills).expect("skills");
        std::os::unix::fs::symlink(&target, skills.join("linked")).expect("link");
        let resolved = resolve_readonly_directory(&skills, Path::new("linked")).expect("resolve");
        assert!(resolved.is_symlink);
        assert!(resolved.external_target);
    }
    let _ = fs::remove_dir_all(root);
}
