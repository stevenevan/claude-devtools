use std::fs;
use std::path::Path;

use super::{
    apply_at, preview_at, CodexSettingsApplyResult, CodexSettingsContext, CodexSettingsPatch,
    CodexSettingsPreviewResult,
};

fn fixture(name: &str) -> std::path::PathBuf {
    let path =
        std::env::temp_dir().join(format!("claude-codex-write-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("fixture root");
    path
}

fn context(root: &Path) -> CodexSettingsContext {
    CodexSettingsContext {
        project_root: root.to_string_lossy().into_owned(),
        working_directory: Some(root.to_string_lossy().into_owned()),
        profile: None,
    }
}

#[test]
fn preview_and_apply_preserve_unknown_content_and_create_private_snapshot() {
    let root = fixture("preserve");
    let home = root.join("codex-home");
    fs::create_dir_all(&home).expect("home");
    let target = home.join("config.toml");
    fs::write(
        &target,
        "# keep this comment\nmodel = \"old-model\"\nunknown_key = \"keep-me\"\n",
    )
    .expect("config");
    let current = super::revision(&fs::read(&target).expect("read"));
    let patch = CodexSettingsPatch {
        model: Some("new-model".to_string()),
        ..Default::default()
    };
    let preview = preview_at(&home, &context(&root), &patch, &current, None).expect("preview");
    let CodexSettingsPreviewResult::Ready(preview) = preview else {
        panic!("expected ready preview");
    };
    assert!(preview.can_apply);
    assert_eq!(preview.diff[0].old_value, "old-model");
    let result = apply_at(&home, &context(&root), &patch, &current, None).expect("apply");
    let CodexSettingsApplyResult::Applied(result) = result else {
        panic!("expected applied result");
    };
    assert!(result.snapshot.created);
    assert_eq!(result.snapshot.identity, "config.toml.bak");
    let raw = fs::read_to_string(&target).expect("new config");
    assert!(raw.contains("# keep this comment"));
    assert!(raw.contains("unknown_key = \"keep-me\""));
    assert!(raw.contains("model = \"new-model\""));
    assert!(!home.join(".codex-settings.tmp").exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        assert_eq!(
            fs::metadata(&target)
                .expect("target metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(home.join("config.toml.bak"))
                .expect("snapshot metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn revision_conflict_does_not_write_or_snapshot() {
    let root = fixture("conflict");
    let home = root.join("codex-home");
    fs::create_dir_all(&home).expect("home");
    let target = home.join("config.toml");
    fs::write(&target, "model = \"one\"\n").expect("config");
    let stale = super::revision(b"model = \"one\"\n");
    fs::write(&target, "model = \"two\"\n").expect("external edit");
    let result = apply_at(
        &home,
        &context(&root),
        &CodexSettingsPatch {
            model: Some("three".to_string()),
            ..Default::default()
        },
        &stale,
        None,
    )
    .expect("conflict result");
    assert!(matches!(result, CodexSettingsApplyResult::Conflict(_)));
    assert_eq!(
        fs::read_to_string(&target).expect("target"),
        "model = \"two\"\n"
    );
    assert!(!home.join("config.toml.bak").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn invalid_patch_is_rejected_before_snapshot() {
    let root = fixture("invalid");
    let home = root.join("codex-home");
    fs::create_dir_all(&home).expect("home");
    let target = home.join("config.toml");
    fs::write(&target, "model = \"one\"\n").expect("config");
    let current = super::revision(&fs::read(&target).expect("read"));
    let error = apply_at(
        &home,
        &context(&root),
        &CodexSettingsPatch {
            model: Some("/tmp/model".to_string()),
            ..Default::default()
        },
        &current,
        None,
    )
    .expect_err("invalid model");
    assert!(error.contains("model value is invalid"));
    assert!(!home.join("config.toml.bak").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn symlink_target_is_rejected_without_following_it() {
    let root = fixture("symlink");
    let home = root.join("codex-home");
    let outside = root.join("outside.toml");
    fs::create_dir_all(&home).expect("home");
    fs::write(&outside, "model = \"outside\"\n").expect("outside");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, home.join("config.toml")).expect("symlink");
    #[cfg(unix)]
    {
        let error = apply_at(
            &home,
            &context(&root),
            &CodexSettingsPatch {
                model: Some("new".to_string()),
                ..Default::default()
            },
            &super::revision(b"model = \"outside\"\n"),
            None,
        )
        .expect_err("symlink rejection");
        assert!(error.contains("symlink"));
        assert_eq!(
            fs::read_to_string(&outside).expect("outside read"),
            "model = \"outside\"\n"
        );
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn managed_default_permissions_blocks_safety_edits() {
    let root = fixture("managed-defaults");
    let home = root.join("codex-home");
    let system = root.join("system");
    fs::create_dir_all(&home).expect("home");
    fs::create_dir_all(&system).expect("system");
    let target = home.join("config.toml");
    fs::write(&target, "sandbox_mode = \"read-only\"\n").expect("config");
    fs::write(
        &system.join("requirements.toml"),
        "default_permissions = { mode = \"safe\" }\n",
    )
    .expect("requirements");
    let current = super::revision(&fs::read(&target).expect("read"));
    let error = apply_at(
        &home,
        &context(&root),
        &CodexSettingsPatch {
            sandbox_mode: Some("workspace-write".to_string()),
            ..Default::default()
        },
        &current,
        Some(&system),
    )
    .expect_err("managed safety gate");
    assert!(error.contains("default_permissions"));
    assert!(!home.join("config.toml.bak").exists());
    let _ = fs::remove_dir_all(root);
}
