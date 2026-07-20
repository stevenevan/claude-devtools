//! Ports the capture cases from `configbackup_test.go` (the capture half of the
//! round-trip, plus mode-preserving copy, skip rules, symlinked skills, and the
//! hooks-disabled snapshot). Uses isolated temp dirs — never touches real
//! `~/.claude`.

use super::*;
use crate::configbackup::types::config_backups_dir;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "configbackup-capture-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn sha256_hex(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(content.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Seeds a root with a representative allowlisted profile plus files that MUST
/// be skipped, and returns (root, app_data_dir, expected rel -> content).
fn seed_profile() -> (PathBuf, PathBuf, HashMap<String, String>) {
    let root = temp_dir("root");
    let app = temp_dir("app");
    let mut want: HashMap<String, String> = HashMap::new();

    let mut add = |rel: &str, content: &str| {
        write(&root.join(rel), content);
        want.insert(rel.to_string(), content.to_string());
    };
    add("settings.json", r#"{"theme":"dark"}"#);
    add("CLAUDE.md", "# Global\noriginal\n");
    add("rules/style.md", "rule content\n");
    add("agents/helper.md", "---\nname: helper\n---\nbody\n");
    add("projects/-Users-x-proj/memory/fact.md", "remember this\n");
    add("agent-memory/bar/MEMORY.md", "agent memory\n");
    add("skills/demo/SKILL.md", "# demo skill\n");
    add("skills/demo/references/ref.md", "reference\n");
    add("skills/demo/references/nested/deep.txt", "deep\n");

    // Must be skipped: .bak/.tmp byproducts, non-.md agent, dot-dir memory.
    write(&root.join("rules/style.md.bak"), "OLD");
    write(&root.join("rules/scratch.tmp"), "TMP");
    write(&root.join("agents/helper.txt"), "not markdown");
    write(&root.join("agent-memory/.hidden/MEMORY.md"), "hidden");

    (root, app, want)
}

#[cfg(unix)]
#[test]
fn capture_collects_allowlisted_files_only() {
    let (root, app, want) = seed_profile();

    // A symlinked skill is recorded by target only; its content is never read.
    let external = temp_dir("external-skill");
    write(&external.join("SKILL.md"), "OUT OF ROOT - must not be captured\n");
    std::os::unix::fs::symlink(&external, root.join("skills").join("linked")).unwrap();

    let manifest = capture_config(&root, &app, "snap1", false).unwrap();
    let backup_dir = config_backups_dir(&app).join(&manifest.id);

    let captured: std::collections::HashSet<&str> =
        manifest.files.iter().map(|f| f.rel_path.as_str()).collect();
    let expected: std::collections::HashSet<&str> = want.keys().map(String::as_str).collect();
    assert_eq!(captured, expected, "captured set must equal the allowlisted set");

    // Every entry: bytes copied verbatim + sha matches the captured bytes.
    for entry in &manifest.files {
        let content = &want[&entry.rel_path];
        let copied = fs::read_to_string(backup_dir.join(&entry.rel_path)).unwrap();
        assert_eq!(&copied, content, "content mismatch for {}", entry.rel_path);
        assert_eq!(entry.sha256, sha256_hex(content), "sha mismatch for {}", entry.rel_path);
        assert_eq!(entry.size, content.len() as i64);
    }

    // Symlinked skill: link ref recorded, out-of-root content NOT captured.
    assert_eq!(manifest.skill_links.len(), 1);
    assert_eq!(manifest.skill_links[0].name, "linked");
    assert_eq!(manifest.skill_links[0].target, external.to_string_lossy());
    assert!(!backup_dir.join("skills/linked/SKILL.md").exists());
    assert!(!manifest.files.iter().any(|f| f.rel_path.contains("linked")));
}

#[cfg(unix)]
#[test]
fn capture_preserves_file_modes() {
    use std::os::unix::fs::PermissionsExt;
    let root = temp_dir("mode-root");
    let app = temp_dir("mode-app");
    write(&root.join("settings.json"), "{}");
    write(&root.join("rules/secret.md"), "shh\n");
    fs::set_permissions(root.join("rules/secret.md"), fs::Permissions::from_mode(0o600)).unwrap();
    fs::set_permissions(root.join("settings.json"), fs::Permissions::from_mode(0o644)).unwrap();

    let manifest = capture_config(&root, &app, "m", false).unwrap();
    let backup_dir = config_backups_dir(&app).join(&manifest.id);

    let secret_mode = fs::metadata(backup_dir.join("rules/secret.md"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    let settings_mode = fs::metadata(backup_dir.join("settings.json"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(secret_mode, 0o600);
    assert_eq!(settings_mode, 0o644);

    // Backup dir itself is created 0o700.
    let dir_mode = fs::metadata(&backup_dir).unwrap().permissions().mode() & 0o777;
    assert_eq!(dir_mode, 0o700);
}

#[test]
fn capture_snapshots_hooks_disabled_when_requested() {
    let root = temp_dir("hooks-root");
    let app = temp_dir("hooks-app");
    write(&root.join("settings.json"), "{}");
    fs::write(app.join("hooks-disabled.json"), r#"{"PreToolUse":[]}"#).unwrap();

    let manifest = capture_config(&root, &app, "pre-import", true).unwrap();
    let backup_dir = config_backups_dir(&app).join(&manifest.id);

    let snapshot = backup_dir.join("hooks-disabled.snapshot.json");
    assert!(snapshot.exists(), "hooks-disabled snapshot must be written");
    assert_eq!(fs::read_to_string(&snapshot).unwrap(), r#"{"PreToolUse":[]}"#);
    // The reserved snapshot name is never a manifest file entry.
    assert!(!manifest
        .files
        .iter()
        .any(|f| f.rel_path.contains("hooks-disabled")));
}

#[test]
fn capture_without_flag_skips_hooks_snapshot() {
    let root = temp_dir("nohooks-root");
    let app = temp_dir("nohooks-app");
    write(&root.join("settings.json"), "{}");
    fs::write(app.join("hooks-disabled.json"), r#"{"PreToolUse":[]}"#).unwrap();

    let manifest = capture_config(&root, &app, "snap", false).unwrap();
    let backup_dir = config_backups_dir(&app).join(&manifest.id);
    assert!(!backup_dir.join("hooks-disabled.snapshot.json").exists());
}

#[test]
fn capture_empty_root_yields_empty_manifest() {
    let root = temp_dir("empty-root");
    let app = temp_dir("empty-app");
    let manifest = capture_config(&root, &app, "empty", false).unwrap();
    assert!(manifest.files.is_empty());
    assert!(manifest.skill_links.is_empty());
    assert!(!manifest.secrets_included);
    assert_eq!(manifest.label, "empty");
}
